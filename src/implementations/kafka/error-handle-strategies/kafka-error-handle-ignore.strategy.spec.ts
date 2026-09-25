import { EachBatchPayload, KafkaJSError, KafkaMessage } from 'kafkajs';
import { KafkaErrorHandleIgnoreStrategy } from './kafka-error-handle-ignore.strategy.js';

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

describe('KafkaErrorHandleIgnoreStrategy', () => {
  it('resolves the offset so the failed record is not redelivered', async () => {
    const strategy = new KafkaErrorHandleIgnoreStrategy();
    const payload = batchPayload();

    await strategy.handle(new KafkaJSError('boom'), payload, record());

    expect(payload.resolveOffset).toHaveBeenCalledWith('7');
    expect(payload.heartbeat).toHaveBeenCalledTimes(1);
  });
});
