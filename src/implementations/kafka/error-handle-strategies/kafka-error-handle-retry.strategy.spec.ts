import type { KafkaJS } from '@confluentinc/kafka-javascript';
import type { Logger } from '@nestjs/common';
import { ExponentialBackoff } from './exponential-backoff.js';
import { GroupRetryTopics } from './group-retry-topics.js';
import { HandlerRetryTopics } from './handler-retry-topics.js';
import { KafkaErrorHandleDlqStrategy } from './kafka-error-handle-dlq.strategy.js';
import { KafkaErrorHandleRetryStrategy } from './kafka-error-handle-retry.strategy.js';
import { PausedPartitions } from './paused-partitions.js';
import { RetryDelayGate } from './retry-delay-gate.js';
import { SourceRetryTopics } from './source-retry-topics.js';

const stubLogger = () => ({ warn: jest.fn() }) as unknown as Logger;

const record = () => ({
  key: Buffer.from('k'),
  value: Buffer.from('{}'),
  timestamp: '0',
  size: 0,
  attributes: 0,
  offset: '7',
  headers: { trace: 'abc' },
}) as unknown as KafkaJS.KafkaMessage;

const payloadOn = (topic: string) =>
  ({
    batch: { topic, partition: 0 },
    resolveOffset: jest.fn(),
    pause: jest.fn(() => jest.fn()),
  }) as unknown as KafkaJS.EachBatchPayload;

const producerStub = () => ({ send: jest.fn().mockResolvedValue([]) }) as unknown as KafkaJS.Producer;

const retryTopics = () =>
  new HandlerRetryTopics(SourceRetryTopics.for('svc', 2), new Set(['orders.created']), GroupRetryTopics.for('svc', 2));

const strategy = (producer: KafkaJS.Producer, dlqTopic?: string) =>
  new KafkaErrorHandleRetryStrategy(
    producer,
    retryTopics(),
    ExponentialBackoff.from({ initialMs: 1000 }, 'retry'),
    new RetryDelayGate(retryTopics(), new PausedPartitions(stubLogger()), () => 5000),
    new KafkaErrorHandleDlqStrategy(producer, dlqTopic),
    () => 5000,
  );

const withOriginalTopic = (originalTopic: string) =>
  ({ ...record(), headers: { trace: 'abc', 'retry.original.topic': originalTopic } }) as unknown as KafkaJS.KafkaMessage;

const sent = (producer: KafkaJS.Producer) => (producer.send as jest.Mock).mock.calls[0][0];

describe('KafkaErrorHandleRetryStrategy', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('republishes a failed source message to the first retry topic', async () => {
    const producer = producerStub();
    await strategy(producer).handle(new Error('boom'), payloadOn('orders.created'), record());
    expect(sent(producer).topic).toBe('orders.created.svc.retry.1');
  });

  it('republishes a failed retry to the next retry topic', async () => {
    const producer = producerStub();
    await strategy(producer).handle(new Error('boom'), payloadOn('orders.created.svc.retry.1'), record());
    expect(sent(producer).topic).toBe('orders.created.svc.retry.2');
  });

  it('keeps the key and value of the failed message', async () => {
    const producer = producerStub();
    await strategy(producer).handle(new Error('boom'), payloadOn('orders.created'), record());
    expect(sent(producer).messages[0]).toEqual(expect.objectContaining({ key: Buffer.from('k'), value: Buffer.from('{}') }));
  });

  it('describes the hop in the headers', async () => {
    const producer = producerStub();
    await strategy(producer).handle(new Error('boom'), payloadOn('orders.created.svc.retry.1'), record());
    expect(sent(producer).messages[0].headers).toEqual(expect.objectContaining({
      trace: 'abc',
      'retry.original.topic': 'orders.created',
      'retry.attempt': '2',
      'retry.due': '7000',
      'retry.error.message': 'boom',
    }));
  });

  it('resolves the offset once the retry is published', async () => {
    const payload = payloadOn('orders.created');
    await strategy(producerStub()).handle(new Error('boom'), payload, record());
    expect(payload.resolveOffset).toHaveBeenCalledWith('7');
  });

  it('dead-letters a failed last retry under its original topic', async () => {
    const producer = producerStub();
    await strategy(producer).handle(new Error('boom'), payloadOn('orders.created.svc.retry.2'), record());
    expect(sent(producer)).toEqual(expect.objectContaining({ topic: 'orders.created.dlq' }));
  });

  it('publishes only the dead letter when the last retry fails', async () => {
    const producer = producerStub();
    await strategy(producer).handle(new Error('boom'), payloadOn('orders.created.svc.retry.2'), record());
    expect(producer.send).toHaveBeenCalledTimes(1);
  });

  it('records the original topic on the dead letter', async () => {
    const producer = producerStub();
    await strategy(producer).handle(new Error('boom'), payloadOn('orders.created.svc.retry.2'), record());
    expect(sent(producer).messages[0].headers['dlq.original.topic']).toBe('orders.created');
  });

  it('dead-letters to an explicitly configured topic', async () => {
    const producer = producerStub();
    await strategy(producer, 'parking.lot').handle(new Error('boom'), payloadOn('orders.created.svc.retry.2'), record());
    expect(sent(producer).topic).toBe('parking.lot');
  });

  it('leaves the offset unresolved when the retry cannot be published', async () => {
    const producer = { send: jest.fn().mockRejectedValue(new Error('broker down')) } as unknown as KafkaJS.Producer;
    const payload = payloadOn('orders.created');
    await expect(strategy(producer).handle(new Error('boom'), payload, record())).rejects.toThrow('broker down');
    expect(payload.resolveOffset).not.toHaveBeenCalled();
  });

  it('consumes every retry topic of its source topics', () => {
    expect(strategy(producerStub()).consumedTopics(['orders.created'])).toEqual([
      'orders.created.svc.retry.1',
      'orders.created.svc.retry.2',
    ]);
  });

  it('needs its retry topics, group retry topics and dead letter topics to exist', () => {
    expect(strategy(producerStub()).destinationTopics(['orders.created'])).toEqual([
      'orders.created.svc.retry.1',
      'orders.created.svc.retry.2',
      'svc.retry.1',
      'svc.retry.2',
      'orders.created.dlq',
    ]);
  });

  it('holds a retry message that is not due yet', () => {
    const message = { ...record(), headers: { 'retry.due': '9000' } } as KafkaJS.KafkaMessage;
    expect(strategy(producerStub()).holdUntilDue(payloadOn('orders.created.svc.retry.1'), message)).toBe(true);
  });

  it('republishes a failed pattern source message to the first group retry topic', async () => {
    const producer = producerStub();
    await strategy(producer).handle(new Error('boom'), payloadOn('audit.eu'), record());
    expect(sent(producer).topic).toBe('svc.retry.1');
  });

  it('carries the pattern source through a group retry hop', async () => {
    const producer = producerStub();
    await strategy(producer).handle(new Error('boom'), payloadOn('svc.retry.1'), withOriginalTopic('audit.eu'));
    expect([sent(producer).topic, sent(producer).messages[0].headers['retry.original.topic']]).toEqual(['svc.retry.2', 'audit.eu']);
  });

  it('dead-letters a failed last group retry under its original topic', async () => {
    const producer = producerStub();
    await strategy(producer).handle(new Error('boom'), payloadOn('svc.retry.2'), withOriginalTopic('audit.eu'));
    expect(sent(producer).topic).toBe('audit.eu.dlq');
  });

  it('lists the group retry topics as shared consumed topics', () => {
    expect(strategy(producerStub()).sharedConsumedTopics()).toEqual(['svc.retry.1', 'svc.retry.2']);
  });
});
