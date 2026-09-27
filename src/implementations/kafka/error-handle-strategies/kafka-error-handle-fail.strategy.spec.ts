import type { KafkaJS } from '@confluentinc/kafka-javascript';
import { KafkaErrorHandleFailStrategy } from './kafka-error-handle-fail.strategy.js';

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
    heartbeat: jest.fn().mockResolvedValue(undefined),
  }) as unknown as KafkaJS.EachBatchPayload;

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
});
