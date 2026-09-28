import type { KafkaJS } from '@confluentinc/kafka-javascript';
import { KafkaErrorHandleFailStrategy } from './kafka-error-handle-fail.strategy.js';
import type { RedeliveryBackoff } from './redelivery-backoff.js';

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
    batch: { topic: 'orders.created' },
    resolveOffset: jest.fn(),
  }) as unknown as KafkaJS.EachBatchPayload;

const redeliveryStub = () =>
  ({ postpone: jest.fn(), stop: jest.fn() }) as unknown as RedeliveryBackoff & {
    postpone: jest.Mock;
    stop: jest.Mock;
  };

describe('KafkaErrorHandleFailStrategy', () => {
  it('rethrows the error so the client stops the batch', async () => {
    const strategy = new KafkaErrorHandleFailStrategy();
    const payload = batchPayload();
    const error = new Error('handler exploded');

    await expect(strategy.handle(error, payload, record())).rejects.toBe(error);
  });

  it('does not resolve the offset', async () => {
    const strategy = new KafkaErrorHandleFailStrategy();
    const payload = batchPayload();

    await strategy
      .handle(new Error('handler exploded'), payload, record())
      .catch(() => undefined);

    expect(payload.resolveOffset).not.toHaveBeenCalled();
  });

  describe('with redelivery backoff', () => {
    it('rethrows the error so the client stops the batch', async () => {
      const strategy = new KafkaErrorHandleFailStrategy(redeliveryStub());
      const error = new Error('handler exploded');

      await expect(strategy.handle(error, batchPayload(), record())).rejects.toBe(error);
    });

    it('postpones redelivery of the failed message', async () => {
      const redelivery = redeliveryStub();
      const strategy = new KafkaErrorHandleFailStrategy(redelivery);
      const payload = batchPayload();
      const message = record();

      await strategy.handle(new Error('handler exploded'), payload, message).catch(() => undefined);

      expect(redelivery.postpone).toHaveBeenCalledWith(payload, message);
    });

    it('does not resolve the offset', async () => {
      const strategy = new KafkaErrorHandleFailStrategy(redeliveryStub());
      const payload = batchPayload();

      await strategy
        .handle(new Error('handler exploded'), payload, record())
        .catch(() => undefined);

      expect(payload.resolveOffset).not.toHaveBeenCalled();
    });

    it('stops the redelivery backoff when stopped', () => {
      const redelivery = redeliveryStub();
      const strategy = new KafkaErrorHandleFailStrategy(redelivery);

      strategy.stop();

      expect(redelivery.stop).toHaveBeenCalledTimes(1);
    });
  });
});
