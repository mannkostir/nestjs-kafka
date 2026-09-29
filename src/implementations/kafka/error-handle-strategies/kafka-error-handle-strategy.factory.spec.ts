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

describe('KafkaErrorHandleStrategyFactory', () => {
  describe('ignore', () => {
    it('returns the same instance on repeated calls', () => {
      const factory = new KafkaErrorHandleStrategyFactory(namespacer());

      const first = factory.create({ type: 'ignore' }, true);
      const second = factory.create({ type: 'ignore' }, true);

      expect(second).toBe(first);
    });
  });

  describe('dlq', () => {
    it('returns the same instance for the same topic', () => {
      const factory = new KafkaErrorHandleStrategyFactory(namespacer(), producerStub());

      const first = factory.create({ type: 'dlq', topic: 'parking.lot' }, true);
      const second = factory.create({ type: 'dlq', topic: 'parking.lot' }, true);

      expect(second).toBe(first);
    });

    it('returns distinct instances for different topics', () => {
      const factory = new KafkaErrorHandleStrategyFactory(namespacer(), producerStub());

      const first = factory.create({ type: 'dlq', topic: 'parking.lot' }, true);
      const second = factory.create({ type: 'dlq', topic: 'graveyard' }, true);

      expect(second).not.toBe(first);
    });

    it('publishes to the namespaced topic when namespaced', async () => {
      const producer = producerStub();
      const factory = new KafkaErrorHandleStrategyFactory(namespacer(), producer);
      const strategy = factory.create({ type: 'dlq', topic: 'parking.lot' }, true);

      await strategy.handle(new Error('boom'), batchPayload(), record());

      expect(producer.send).toHaveBeenCalledWith(
        expect.objectContaining({ topic: 'acme.parking.lot' }),
      );
    });

    it('publishes to the raw topic when not namespaced', async () => {
      const producer = producerStub();
      const factory = new KafkaErrorHandleStrategyFactory(namespacer(), producer);
      const strategy = factory.create({ type: 'dlq', topic: 'parking.lot' }, false);

      await strategy.handle(new Error('boom'), batchPayload(), record());

      expect(producer.send).toHaveBeenCalledWith(
        expect.objectContaining({ topic: 'parking.lot' }),
      );
    });

    it('rejects the dlq type without a producer', () => {
      const factory = new KafkaErrorHandleStrategyFactory(namespacer());

      expect(() => factory.create({ type: 'dlq' }, true)).toThrow(
        'DLQ error handling requires a producer. ' +
        'Provide "producer" in KafkaConsumer options.',
      );
    });
  });

  describe('fail', () => {
    it('returns a new instance on every call', () => {
      const factory = new KafkaErrorHandleStrategyFactory(namespacer());

      const first = factory.create({ type: 'fail', backoff: false }, true);
      const second = factory.create({ type: 'fail', backoff: false }, true);

      expect(second).not.toBe(first);
    });

    it('pauses the partition by default', async () => {
      const factory = new KafkaErrorHandleStrategyFactory(namespacer());
      const strategy = factory.create({ type: 'fail' }, true);
      const payload = batchPayload();

      await strategy.handle(new Error('boom'), payload, record()).catch(() => undefined);
      strategy.stop();

      expect(payload.pause).toHaveBeenCalledTimes(1);
    });

    it('does not pause the partition when backoff is disabled', async () => {
      const factory = new KafkaErrorHandleStrategyFactory(namespacer());
      const strategy = factory.create({ type: 'fail', backoff: false }, true);
      const payload = batchPayload();

      await strategy.handle(new Error('boom'), payload, record()).catch(() => undefined);

      expect(payload.pause).not.toHaveBeenCalled();
    });
  });

  it('rejects an unknown type', () => {
    const factory = new KafkaErrorHandleStrategyFactory(namespacer());

    expect(() =>
      factory.create({ type: 'retry' } as unknown as MessageErrorHandlingConfig, true),
    ).toThrow('Message error handle strategy not found for type: retry');
  });
});
