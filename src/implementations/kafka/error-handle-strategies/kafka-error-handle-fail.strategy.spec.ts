import { EachBatchPayload, KafkaJSError, KafkaMessage } from 'kafkajs';
import { KafkaErrorHandleFailStrategy } from './kafka-error-handle-fail.strategy.js';

const record = (): KafkaMessage => ({
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
  }) as unknown as EachBatchPayload;

describe('KafkaErrorHandleFailStrategy', () => {
  it('rethrows the error so kafkajs stops the batch', async () => {
    const strategy = new KafkaErrorHandleFailStrategy();
    const payload = batchPayload();
    const error = new KafkaJSError('handler exploded');

    await expect(strategy.handle(error, payload, record())).rejects.toBe(error);
  });

  it('does not resolve the offset', async () => {
    const strategy = new KafkaErrorHandleFailStrategy();
    const payload = batchPayload();

    await strategy
      .handle(new KafkaJSError('handler exploded'), payload, record())
      .catch(() => undefined);

    expect(payload.resolveOffset).not.toHaveBeenCalled();
  });
});
