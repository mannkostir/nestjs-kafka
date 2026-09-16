import { EachBatchPayload, KafkaJSError, KafkaMessage, Producer } from 'kafkajs';
import { KafkaErrorHandleDlqStrategy } from './kafka-error-handle-dlq.strategy';

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

const producerStub = () =>
  ({ send: jest.fn().mockResolvedValue([]) }) as unknown as Producer;

describe('KafkaErrorHandleDlqStrategy', () => {
  it('publishes to the suffixed dead letter topic by default', async () => {
    const producer = producerStub();
    const strategy = new KafkaErrorHandleDlqStrategy(producer);

    await strategy.handle(new KafkaJSError('boom'), batchPayload(), record());

    expect(producer.send).toHaveBeenCalledWith(
      expect.objectContaining({ topic: 'orders.created.dlq' }),
    );
  });

  it('publishes to an explicitly configured dead letter topic', async () => {
    const producer = producerStub();
    const strategy = new KafkaErrorHandleDlqStrategy(producer, 'parking.lot');

    await strategy.handle(new KafkaJSError('boom'), batchPayload(), record());

    expect(producer.send).toHaveBeenCalledWith(
      expect.objectContaining({ topic: 'parking.lot' }),
    );
  });

  it('attaches the original topic and error context as headers', async () => {
    const producer = producerStub();
    const strategy = new KafkaErrorHandleDlqStrategy(producer);

    await strategy.handle(new KafkaJSError('boom'), batchPayload(), record());

    const sent = (producer.send as jest.Mock).mock.calls[0][0];

    expect(sent.messages[0].headers).toEqual(
      expect.objectContaining({
        'dlq.original.topic': 'orders.created',
        'dlq.error.message': 'boom',
        'dlq.error.name': 'KafkaJSError',
      }),
    );
    expect(sent.messages[0].headers['dlq.timestamp']).toEqual(
      expect.any(String),
    );
  });

  it('resolves the offset after publishing', async () => {
    const producer = producerStub();
    const strategy = new KafkaErrorHandleDlqStrategy(producer);
    const payload = batchPayload();

    await strategy.handle(new KafkaJSError('boom'), payload, record());

    expect(payload.resolveOffset).toHaveBeenCalledWith('7');
  });
});
