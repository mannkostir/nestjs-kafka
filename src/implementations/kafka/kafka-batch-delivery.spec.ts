import type { KafkaJS } from '@confluentinc/kafka-javascript';
import { Logger } from '@nestjs/common';
import { KafkaBatchDelivery } from './kafka-batch-delivery.js';
import { KafkaMessageParseStrategyFactory } from './parse-strategies/kafka-message-parse-strategy.factory.js';
import { KafkaErrorHandleIgnoreStrategy } from './error-handle-strategies/kafka-error-handle-ignore.strategy.js';
import { KafkaErrorHandleFailStrategy } from './error-handle-strategies/kafka-error-handle-fail.strategy.js';
import { KafkaErrorHandleDlqStrategy } from './error-handle-strategies/kafka-error-handle-dlq.strategy.js';
import { KafkaErrorHandleStrategy } from './error-handle-strategies/kafka-error-handle.strategy.js';
import { MessageFormat } from '../../types/message-format.type.js';
import { BatchFailure } from '../../errors/batch-failure.js';
import { ReceivedMessage } from '../../types/received-message.type.js';

const record = (offset: string, value: unknown = { id: offset }): KafkaJS.KafkaMessage => ({
  key: Buffer.from(`key-${offset}`),
  value: Buffer.from(JSON.stringify(value)),
  timestamp: '1700000000000',
  size: 0,
  attributes: 0,
  offset,
  headers: {},
} as unknown as KafkaJS.KafkaMessage);

const undecodable = (offset: string): KafkaJS.KafkaMessage =>
  ({ ...record(offset), value: Buffer.from('{not json') }) as KafkaJS.KafkaMessage;

const payloadOf = (messages: KafkaJS.KafkaMessage[]) => {
  let stale = false;
  return {
    batch: { topic: 'orders', partition: 3, messages },
    isRunning: jest.fn(() => true),
    isStale: jest.fn(() => stale),
    markStale: () => { stale = true; },
    resolveOffset: jest.fn(),
    pause: jest.fn(() => jest.fn()),
  };
};

type StubPayload = ReturnType<typeof payloadOf>;

const asPayload = (payload: StubPayload) => payload as unknown as KafkaJS.EachBatchPayload;

const json = new KafkaMessageParseStrategyFactory().create(MessageFormat.JSON);

const producerStub = () => ({ send: jest.fn().mockResolvedValue([]) });

class HoldingStrategy extends KafkaErrorHandleStrategy {
  readonly held: string[] = [];

  constructor(private readonly heldOffset: string) {
    super();
  }

  public async handle(): Promise<void> {}

  public override isDue(_payload: KafkaJS.EachBatchPayload, message: KafkaJS.KafkaMessage): boolean {
    return message.offset !== this.heldOffset;
  }

  public override holdUntilDue(_payload: KafkaJS.EachBatchPayload, message: KafkaJS.KafkaMessage): boolean {
    this.held.push(message.offset);
    return true;
  }
}

const resolvedOffsets = (payload: StubPayload) =>
  payload.resolveOffset.mock.calls.map(([offset]) => offset);

const deliveredOffsets = (handler: jest.Mock) =>
  handler.mock.calls.map(([batch]: [ReceivedMessage[]]) => batch.map((entry) => entry.context.offset));

const delivery = (handler: jest.Mock, strategy: KafkaErrorHandleStrategy) =>
  new KafkaBatchDelivery(handler, json, strategy, 'orders-indexer', { warn: jest.fn() } as unknown as Logger);

describe('KafkaBatchDelivery on success', () => {
  it('hands every message of the batch to the handler in one call', async () => {
    const handler = jest.fn().mockResolvedValue(undefined);
    await delivery(handler, new KafkaErrorHandleIgnoreStrategy()).deliver(asPayload(payloadOf([record('1'), record('2'), record('3')])));
    expect(deliveredOffsets(handler)).toEqual([['1', '2', '3']]);
  });

  it('hands decoded messages with where they were read from', async () => {
    const handler = jest.fn().mockResolvedValue(undefined);
    await delivery(handler, new KafkaErrorHandleIgnoreStrategy()).deliver(asPayload(payloadOf([record('7', { id: 'a' })])));
    expect(handler.mock.calls[0][0][0]).toEqual({
      message: expect.objectContaining({ value: { id: 'a' }, key: 'key-7' }),
      context: { topic: 'orders', partition: 3, offset: '7', timestamp: '1700000000000' },
    });
  });

  it('resolves every message after the handler succeeds', async () => {
    const payload = payloadOf([record('1'), record('2')]);
    await delivery(jest.fn().mockResolvedValue(undefined), new KafkaErrorHandleIgnoreStrategy()).deliver(asPayload(payload));
    expect(resolvedOffsets(payload)).toEqual(['1', '2']);
  });

  it('does not call the handler for an empty batch', async () => {
    const handler = jest.fn();
    await delivery(handler, new KafkaErrorHandleIgnoreStrategy()).deliver(asPayload(payloadOf([])));
    expect(handler).not.toHaveBeenCalled();
  });

  it('does not call the handler when the batch is already stale', async () => {
    const handler = jest.fn();
    const payload = payloadOf([record('1')]);
    payload.markStale();
    await delivery(handler, new KafkaErrorHandleIgnoreStrategy()).deliver(asPayload(payload));
    expect(handler).not.toHaveBeenCalled();
  });

  it('does not call the handler when the consumer is stopping', async () => {
    const handler = jest.fn();
    const payload = payloadOf([record('1')]);
    payload.isRunning.mockReturnValue(false);
    await delivery(handler, new KafkaErrorHandleIgnoreStrategy()).deliver(asPayload(payload));
    expect(handler).not.toHaveBeenCalled();
  });
});

describe('KafkaBatchDelivery when the handler throws', () => {
  it('lets the ignore policy resolve every message', async () => {
    const payload = payloadOf([record('1'), record('2')]);
    await delivery(jest.fn().mockRejectedValue(new Error('boom')), new KafkaErrorHandleIgnoreStrategy()).deliver(asPayload(payload));
    expect(resolvedOffsets(payload)).toEqual(['1', '2']);
  });

  it('dead-letters every message under the dlq policy', async () => {
    const producer = producerStub();
    await delivery(
      jest.fn().mockRejectedValue(new Error('boom')),
      new KafkaErrorHandleDlqStrategy(producer as unknown as KafkaJS.Producer),
    ).deliver(asPayload(payloadOf([record('1'), record('2')])));
    expect(producer.send.mock.calls.map(([sent]) => sent.messages[0].key.toString())).toEqual(['key-1', 'key-2']);
  });

  it('rethrows under the fail policy without resolving anything', async () => {
    const payload = payloadOf([record('1'), record('2')]);
    await expect(
      delivery(jest.fn().mockRejectedValue(new Error('boom')), new KafkaErrorHandleFailStrategy()).deliver(asPayload(payload)),
    ).rejects.toThrow('boom');
    expect(payload.resolveOffset).not.toHaveBeenCalled();
  });

  it('hands a thrown non-error value to the policy', async () => {
    const strategy = new KafkaErrorHandleIgnoreStrategy();
    const handle = jest.spyOn(strategy, 'handle');
    await delivery(jest.fn().mockRejectedValue('nope'), strategy).deliver(asPayload(payloadOf([record('1')])));
    expect(handle).toHaveBeenCalledWith('nope', expect.anything(), expect.objectContaining({ offset: '1' }));
  });
});

describe('KafkaBatchDelivery when the handler throws a BatchFailure', () => {
  it('resolves the messages before the failing index', async () => {
    const payload = payloadOf([record('1'), record('2'), record('3')]);
    await delivery(jest.fn().mockRejectedValue(new BatchFailure(1, new Error('boom'))), new KafkaErrorHandleFailStrategy())
      .deliver(asPayload(payload)).catch(() => undefined);
    expect(resolvedOffsets(payload)).toEqual(['1']);
  });

  it('applies the policy to the failing message only', async () => {
    const producer = producerStub();
    await delivery(
      jest.fn().mockRejectedValue(new BatchFailure(1, new Error('boom'))),
      new KafkaErrorHandleDlqStrategy(producer as unknown as KafkaJS.Producer),
    ).deliver(asPayload(payloadOf([record('1'), record('2'), record('3')])));
    expect(producer.send.mock.calls.map(([sent]) => sent.messages[0].key.toString())).toEqual(['key-2']);
  });

  it('hands the policy the cause rather than the BatchFailure', async () => {
    const cause = new Error('boom');
    const strategy = new KafkaErrorHandleIgnoreStrategy();
    const handle = jest.spyOn(strategy, 'handle');
    await delivery(jest.fn().mockRejectedValue(new BatchFailure(0, cause)), strategy).deliver(asPayload(payloadOf([record('1')])));
    expect(handle).toHaveBeenCalledWith(cause, expect.anything(), expect.objectContaining({ offset: '1' }));
  });

  it('leaves the messages after the failing index unresolved', async () => {
    const payload = payloadOf([record('1'), record('2'), record('3')]);
    await delivery(jest.fn().mockRejectedValue(new BatchFailure(1, new Error('boom'))), new KafkaErrorHandleIgnoreStrategy())
      .deliver(asPayload(payload));
    expect(resolvedOffsets(payload)).toEqual(['1', '2']);
  });

  it('applies the policy to the last message when it is the one that failed', async () => {
    const payload = payloadOf([record('1'), record('2')]);
    await delivery(jest.fn().mockRejectedValue(new BatchFailure(1, new Error('boom'))), new KafkaErrorHandleIgnoreStrategy())
      .deliver(asPayload(payload));
    expect(resolvedOffsets(payload)).toEqual(['1', '2']);
  });

  it('treats an index past the end as a failure of the whole batch', async () => {
    const producer = producerStub();
    await delivery(
      jest.fn().mockRejectedValue(new BatchFailure(5, new Error('boom'))),
      new KafkaErrorHandleDlqStrategy(producer as unknown as KafkaJS.Producer),
    ).deliver(asPayload(payloadOf([record('1'), record('2')])));
    expect(producer.send).toHaveBeenCalledTimes(2);
  });

  it('warns naming the group and the index past the end', async () => {
    const logger = { warn: jest.fn() } as unknown as Logger;
    await new KafkaBatchDelivery(
      jest.fn().mockRejectedValue(new BatchFailure(5, new Error('boom'))),
      json,
      new KafkaErrorHandleIgnoreStrategy(),
      'orders-indexer',
      logger,
    ).deliver(asPayload(payloadOf([record('1'), record('2')])));
    expect(logger.warn).toHaveBeenCalledWith(expect.stringMatching(/orders-indexer.*index 5.*2 messages/));
  });
});

describe('KafkaBatchDelivery with a message that cannot be decoded', () => {
  it('hands the handler only the messages before it', async () => {
    const handler = jest.fn().mockResolvedValue(undefined);
    await delivery(handler, new KafkaErrorHandleIgnoreStrategy())
      .deliver(asPayload(payloadOf([record('1'), undecodable('2'), record('3')])));
    expect(deliveredOffsets(handler)).toEqual([['1']]);
  });

  it('applies the policy to it after the handler succeeds', async () => {
    const payload = payloadOf([record('1'), undecodable('2'), record('3')]);
    await delivery(jest.fn().mockResolvedValue(undefined), new KafkaErrorHandleIgnoreStrategy()).deliver(asPayload(payload));
    expect(resolvedOffsets(payload)).toEqual(['1', '2']);
  });

  it('applies the policy to it when it is the first message', async () => {
    const handler = jest.fn();
    const payload = payloadOf([undecodable('1'), record('2')]);
    await delivery(handler, new KafkaErrorHandleIgnoreStrategy()).deliver(asPayload(payload));
    expect({ called: handler.mock.calls.length, resolved: resolvedOffsets(payload) }).toEqual({ called: 0, resolved: ['1'] });
  });

  it('leaves it unresolved when the handler failed', async () => {
    const payload = payloadOf([record('1'), undecodable('2')]);
    await expect(
      delivery(jest.fn().mockRejectedValue(new Error('boom')), new KafkaErrorHandleFailStrategy()).deliver(asPayload(payload)),
    ).rejects.toThrow('boom');
    expect(payload.resolveOffset).not.toHaveBeenCalled();
  });
});

describe('KafkaBatchDelivery with a message that is not due', () => {
  it('delivers the due prefix, then holds the partition', async () => {
    const handler = jest.fn().mockResolvedValue(undefined);
    const strategy = new HoldingStrategy('2');
    await delivery(handler, strategy).deliver(asPayload(payloadOf([record('1'), record('2'), record('3')])));
    expect({ delivered: deliveredOffsets(handler), held: strategy.held }).toEqual({ delivered: [['1']], held: ['2'] });
  });

  it('leaves the held message and everything after it unresolved', async () => {
    const payload = payloadOf([record('1'), record('2'), record('3')]);
    await delivery(jest.fn().mockResolvedValue(undefined), new HoldingStrategy('2')).deliver(asPayload(payload));
    expect(resolvedOffsets(payload)).toEqual(['1']);
  });

  it('does not hold the partition when the handler failed', async () => {
    const strategy = new HoldingStrategy('2');
    await delivery(jest.fn().mockRejectedValue(new Error('boom')), strategy)
      .deliver(asPayload(payloadOf([record('1'), record('2')])));
    expect(strategy.held).toEqual([]);
  });

  it('does not act on the remainder when the batch went stale during the handler', async () => {
    const strategy = new HoldingStrategy('2');
    const payload = payloadOf([record('1'), record('2')]);
    const handler = jest.fn(async () => payload.markStale());
    await delivery(handler, strategy).deliver(asPayload(payload));
    expect(strategy.held).toEqual([]);
  });
});
