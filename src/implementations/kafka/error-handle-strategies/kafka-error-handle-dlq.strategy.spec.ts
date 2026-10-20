import type { KafkaJS } from '@confluentinc/kafka-javascript';
import type { Logger } from '@nestjs/common';
import { ExponentialBackoff } from './exponential-backoff.js';
import { KafkaErrorHandleDlqStrategy } from './kafka-error-handle-dlq.strategy.js';
import { PublishFailureBackoff } from './publish-failure-backoff.js';
import { RedeliveryBackoff } from './redelivery-backoff.js';

const record = (): KafkaJS.KafkaMessage => ({
  key: null,
  value: Buffer.from('{}'),
  timestamp: '0',
  size: 0,
  attributes: 0,
  offset: '7',
});

const batchPayload = (resume: () => void = jest.fn()) =>
  ({
    batch: { topic: 'orders.created', partition: 0 },
    resolveOffset: jest.fn(),
    pause: jest.fn(() => resume),
  }) as unknown as KafkaJS.EachBatchPayload;

const producerStub = () =>
  ({ send: jest.fn().mockResolvedValue([]) }) as unknown as KafkaJS.Producer;

const rejectingProducer = (error: Error) =>
  ({ send: jest.fn().mockRejectedValue(error) }) as unknown as KafkaJS.Producer;

const stubLogger = () => ({ warn: jest.fn() }) as unknown as Logger;

const publishBackoff = () =>
  new PublishFailureBackoff(new RedeliveryBackoff(ExponentialBackoff.from({}, 'fail'), stubLogger()), stubLogger());

describe('KafkaErrorHandleDlqStrategy', () => {
  it('names the suffixed dead letter topic of every source topic as a destination', () => {
    const strategy = new KafkaErrorHandleDlqStrategy(producerStub(), publishBackoff());

    expect(strategy.destinationTopics(['orders.created', 'orders.updated'])).toEqual([
      'orders.created.dlq',
      'orders.updated.dlq',
    ]);
  });

  it('names only the explicitly configured dead letter topic as a destination', () => {
    const strategy = new KafkaErrorHandleDlqStrategy(producerStub(), publishBackoff(), 'parking.lot');

    expect(strategy.destinationTopics(['orders.created', 'orders.updated'])).toEqual(['parking.lot']);
  });

  it('names the explicitly configured dead letter topic even without source topics', () => {
    const strategy = new KafkaErrorHandleDlqStrategy(producerStub(), publishBackoff(), 'parking.lot');

    expect(strategy.destinationTopics([])).toEqual(['parking.lot']);
  });

  it('publishes to the suffixed dead letter topic by default', async () => {
    const producer = producerStub();
    const strategy = new KafkaErrorHandleDlqStrategy(producer, publishBackoff());

    await strategy.handle(new TypeError('boom'), batchPayload(), record());

    expect(producer.send).toHaveBeenCalledWith(
      expect.objectContaining({ topic: 'orders.created.dlq' }),
    );
  });

  it('publishes to an explicitly configured dead letter topic', async () => {
    const producer = producerStub();
    const strategy = new KafkaErrorHandleDlqStrategy(producer, publishBackoff(), 'parking.lot');

    await strategy.handle(new TypeError('boom'), batchPayload(), record());

    expect(producer.send).toHaveBeenCalledWith(
      expect.objectContaining({ topic: 'parking.lot' }),
    );
  });

  it('attaches the original topic and error context as headers', async () => {
    const producer = producerStub();
    const strategy = new KafkaErrorHandleDlqStrategy(producer, publishBackoff());

    await strategy.handle(new TypeError('boom'), batchPayload(), record());

    const sent = (producer.send as jest.Mock).mock.calls[0][0];

    expect(sent.messages[0].headers).toEqual(
      expect.objectContaining({
        'dlq.original.topic': 'orders.created',
        'dlq.error.message': 'boom',
        'dlq.error.name': 'TypeError',
      }),
    );
    expect(sent.messages[0].headers['dlq.timestamp']).toEqual(
      expect.any(String),
    );
  });

  it('resolves the offset after publishing', async () => {
    const producer = producerStub();
    const strategy = new KafkaErrorHandleDlqStrategy(producer, publishBackoff());
    const payload = batchPayload();

    await strategy.handle(new TypeError('boom'), payload, record());

    expect(payload.resolveOffset).toHaveBeenCalledWith('7');
  });

  it('describes a thrown non-Error value in the headers', async () => {
    const producer = producerStub();
    const strategy = new KafkaErrorHandleDlqStrategy(producer, publishBackoff());

    await strategy.handle('plain string failure', batchPayload(), record());

    const sent = (producer.send as jest.Mock).mock.calls[0][0];

    expect(sent.messages[0].headers).toEqual(
      expect.objectContaining({
        'dlq.error.message': 'plain string failure',
        'dlq.error.name': 'Error',
      }),
    );
  });

  it('republishes only the producer fields of the failed record', async () => {
    const producer = producerStub();
    const strategy = new KafkaErrorHandleDlqStrategy(producer, publishBackoff());

    await strategy.handle(new TypeError('boom'), batchPayload(), record());

    const sent = (producer.send as jest.Mock).mock.calls[0][0];

    expect(Object.keys(sent.messages[0]).sort()).toEqual([
      'headers',
      'key',
      'timestamp',
      'value',
    ]);
  });

  it('carries the original key and value bytes', async () => {
    const producer = producerStub();
    const strategy = new KafkaErrorHandleDlqStrategy(producer, publishBackoff());
    const failed = { ...record(), key: Buffer.from('order-1'), value: Buffer.from('{"a":1}') };

    await strategy.handle(new TypeError('boom'), batchPayload(), failed);

    const sent = (producer.send as jest.Mock).mock.calls[0][0];

    expect(sent.messages[0]).toEqual(
      expect.objectContaining({ key: failed.key, value: failed.value }),
    );
  });

  it('publishes to the dead letter topic derived from the given original topic', async () => {
    const producer = producerStub();
    const strategy = new KafkaErrorHandleDlqStrategy(producer, publishBackoff());

    await strategy.publish(new Error('boom'), 'orders.created', record());

    expect(producer.send).toHaveBeenCalledWith(expect.objectContaining({ topic: 'orders.created.dlq' }));
  });

  it('records the given original topic in the headers', async () => {
    const producer = producerStub();
    const strategy = new KafkaErrorHandleDlqStrategy(producer, publishBackoff());

    await strategy.publish(new Error('boom'), 'orders.created', record());

    const sent = (producer.send as jest.Mock).mock.calls[0][0];
    expect(sent.messages[0].headers['dlq.original.topic']).toBe('orders.created');
  });

  describe('when the dead letter cannot be published', () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('rethrows the publish error', async () => {
      const failure = new Error('broker down');
      const strategy = new KafkaErrorHandleDlqStrategy(rejectingProducer(failure), publishBackoff());

      await expect(strategy.handle(new TypeError('boom'), batchPayload(), record())).rejects.toBe(failure);
    });

    it('leaves the offset unresolved', async () => {
      const strategy = new KafkaErrorHandleDlqStrategy(rejectingProducer(new Error('broker down')), publishBackoff());
      const payload = batchPayload();

      await strategy.handle(new TypeError('boom'), payload, record()).catch(() => undefined);

      expect(payload.resolveOffset).not.toHaveBeenCalled();
    });

    it('pauses the partition', async () => {
      const strategy = new KafkaErrorHandleDlqStrategy(rejectingProducer(new Error('broker down')), publishBackoff());
      const payload = batchPayload();

      await strategy.handle(new TypeError('boom'), payload, record()).catch(() => undefined);

      expect(payload.pause).toHaveBeenCalledTimes(1);
    });

    it('never resumes the paused partition after being stopped', async () => {
      const strategy = new KafkaErrorHandleDlqStrategy(rejectingProducer(new Error('broker down')), publishBackoff());
      const resume = jest.fn();
      await strategy.handle(new TypeError('boom'), batchPayload(resume), record()).catch(() => undefined);

      strategy.stop();
      jest.advanceTimersByTime(30000);

      expect(resume).not.toHaveBeenCalled();
    });
  });
});
