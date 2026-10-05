import type { KafkaJS } from '@confluentinc/kafka-javascript';
import { KafkaErrorHandleIgnoreStrategy } from './kafka-error-handle-ignore.strategy.js';

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

describe('KafkaErrorHandleIgnoreStrategy', () => {
  it('publishes failed records nowhere', () => {
    const strategy = new KafkaErrorHandleIgnoreStrategy();

    expect(strategy.destinationTopics(['orders.created'])).toEqual([]);
  });

  it('consumes no topics of its own', () => {
    expect(new KafkaErrorHandleIgnoreStrategy().consumedTopics(['orders.created'])).toEqual([]);
  });

  it('resolves the offset so the failed record is not redelivered', async () => {
    const strategy = new KafkaErrorHandleIgnoreStrategy();
    const payload = batchPayload();

    await strategy.handle(new Error('boom'), payload, record());

    expect(payload.resolveOffset).toHaveBeenCalledWith('7');
  });
});
