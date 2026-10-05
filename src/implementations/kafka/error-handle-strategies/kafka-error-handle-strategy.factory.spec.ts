import type { KafkaJS } from '@confluentinc/kafka-javascript';
import { MessageErrorHandlingConfig } from '../../../types/message-error-handling.type.js';
import { TopicNamespacer } from '../topic-namespacer.js';
import { KafkaErrorHandleStrategyFactory } from './kafka-error-handle-strategy.factory.js';

const record = (): KafkaJS.KafkaMessage => ({
  key: null,
  value: Buffer.from('{}'),
  timestamp: '0',
  size: 0,
  attributes: 0,
  offset: '7',
});

const batchPayload = () =>
  ({
    batch: { topic: 'orders.created', partition: 0 },
    resolveOffset: jest.fn(),
    pause: jest.fn(() => undefined),
  }) as unknown as KafkaJS.EachBatchPayload;

const producerStub = () =>
  ({ send: jest.fn().mockResolvedValue([]) }) as unknown as KafkaJS.Producer;

const namespacer = () => new TopicNamespacer('acme');

const scope = (namespaced: boolean, topicPatterns: (string | RegExp)[] = ['orders.created']) => ({
  namespaced,
  groupId: 'svc',
  topicPatterns,
});

describe('KafkaErrorHandleStrategyFactory', () => {
  describe('ignore', () => {
    it('returns the same instance on repeated calls', () => {
      const factory = new KafkaErrorHandleStrategyFactory(namespacer());

      const first = factory.create({ type: 'ignore' }, scope(true));
      const second = factory.create({ type: 'ignore' }, scope(true));

      expect(second).toBe(first);
    });
  });

  describe('dlq', () => {
    it('returns the same instance for the same topic', () => {
      const factory = new KafkaErrorHandleStrategyFactory(namespacer(), producerStub());

      const first = factory.create({ type: 'dlq', topic: 'parking.lot' }, scope(true));
      const second = factory.create({ type: 'dlq', topic: 'parking.lot' }, scope(true));

      expect(second).toBe(first);
    });

    it('returns distinct instances for different topics', () => {
      const factory = new KafkaErrorHandleStrategyFactory(namespacer(), producerStub());

      const first = factory.create({ type: 'dlq', topic: 'parking.lot' }, scope(true));
      const second = factory.create({ type: 'dlq', topic: 'graveyard' }, scope(true));

      expect(second).not.toBe(first);
    });

    it('publishes to the namespaced topic when namespaced', async () => {
      const producer = producerStub();
      const factory = new KafkaErrorHandleStrategyFactory(namespacer(), producer);
      const strategy = factory.create({ type: 'dlq', topic: 'parking.lot' }, scope(true));

      await strategy.handle(new Error('boom'), batchPayload(), record());

      expect(producer.send).toHaveBeenCalledWith(
        expect.objectContaining({ topic: 'acme.parking.lot' }),
      );
    });

    it('publishes to the raw topic when not namespaced', async () => {
      const producer = producerStub();
      const factory = new KafkaErrorHandleStrategyFactory(namespacer(), producer);
      const strategy = factory.create({ type: 'dlq', topic: 'parking.lot' }, scope(false));

      await strategy.handle(new Error('boom'), batchPayload(), record());

      expect(producer.send).toHaveBeenCalledWith(
        expect.objectContaining({ topic: 'parking.lot' }),
      );
    });

    it('rejects the dlq type without a producer', () => {
      const factory = new KafkaErrorHandleStrategyFactory(namespacer());

      expect(() => factory.create({ type: 'dlq' }, scope(true))).toThrow(
        'DLQ error handling requires a producer. ' +
        'Provide "producer" in KafkaConsumer options.',
      );
    });
  });

  describe('fail', () => {
    it('returns a new instance on every call', () => {
      const factory = new KafkaErrorHandleStrategyFactory(namespacer());

      const first = factory.create({ type: 'fail', backoff: false }, scope(true));
      const second = factory.create({ type: 'fail', backoff: false }, scope(true));

      expect(second).not.toBe(first);
    });

    it('pauses the partition by default', async () => {
      const factory = new KafkaErrorHandleStrategyFactory(namespacer());
      const strategy = factory.create({ type: 'fail' }, scope(true));
      const payload = batchPayload();

      await strategy.handle(new Error('boom'), payload, record()).catch(() => undefined);
      strategy.stop();

      expect(payload.pause).toHaveBeenCalledTimes(1);
    });

    it('does not pause the partition when backoff is disabled', async () => {
      const factory = new KafkaErrorHandleStrategyFactory(namespacer());
      const strategy = factory.create({ type: 'fail', backoff: false }, scope(true));
      const payload = batchPayload();

      await strategy.handle(new Error('boom'), payload, record()).catch(() => undefined);

      expect(payload.pause).not.toHaveBeenCalled();
    });
  });

  describe('retry', () => {
    it('builds a fresh instance per subscription', () => {
      const factory = new KafkaErrorHandleStrategyFactory(namespacer(), producerStub());

      expect(factory.create({ type: 'retry', attempts: 2 }, scope(true))).not.toBe(
        factory.create({ type: 'retry', attempts: 2 }, scope(true)),
      );
    });

    it('names retry topics after the subscription group', () => {
      const factory = new KafkaErrorHandleStrategyFactory(namespacer(), producerStub());

      expect(
        factory.create({ type: 'retry', attempts: 1 }, scope(true)).consumedTopics(['acme.orders.created']),
      ).toEqual(['acme.orders.created.svc.retry.1']);
    });

    it('namespaces an explicit dead letter topic', () => {
      const factory = new KafkaErrorHandleStrategyFactory(namespacer(), producerStub());

      expect(
        factory
          .create({ type: 'retry', attempts: 1, dlqTopic: 'parking.lot' }, scope(true))
          .destinationTopics(['acme.orders.created']),
      ).toContain('acme.parking.lot');
    });

    it('keeps an explicit dead letter topic raw when not namespaced', () => {
      const factory = new KafkaErrorHandleStrategyFactory(namespacer(), producerStub());

      expect(
        factory
          .create({ type: 'retry', attempts: 1, dlqTopic: 'parking.lot' }, scope(false))
          .destinationTopics(['orders.created']),
      ).toContain('parking.lot');
    });

    it('rejects retry without a producer', () => {
      expect(() =>
        new KafkaErrorHandleStrategyFactory(namespacer()).create({ type: 'retry', attempts: 1 }, scope(true)),
      ).toThrow(/Retry error handling requires a producer/);
    });

    it('rejects retry on a pattern subscription', () => {
      const factory = new KafkaErrorHandleStrategyFactory(namespacer(), producerStub());

      expect(() =>
        factory.create({ type: 'retry', attempts: 1 }, scope(true, ['orders.created', /^audit\..+/])),
      ).toThrow(/subscribes to a pattern/);
    });

    it('rejects invalid retry backoff', () => {
      const factory = new KafkaErrorHandleStrategyFactory(namespacer(), producerStub());

      expect(() =>
        factory.create({ type: 'retry', attempts: 1, backoff: { multiplier: 0.5 } }, scope(true)),
      ).toThrow(/Invalid retry backoff/);
    });

    it('rejects invalid attempts', () => {
      const factory = new KafkaErrorHandleStrategyFactory(namespacer(), producerStub());

      expect(() => factory.create({ type: 'retry', attempts: 0 }, scope(true))).toThrow(
        /Invalid retry attempts/,
      );
    });
  });

  it('rejects an unknown type', () => {
    const factory = new KafkaErrorHandleStrategyFactory(namespacer());

    expect(() =>
      factory.create({ type: 'skip' } as unknown as MessageErrorHandlingConfig, scope(true)),
    ).toThrow('Message error handle strategy not found for type: skip');
  });
});
