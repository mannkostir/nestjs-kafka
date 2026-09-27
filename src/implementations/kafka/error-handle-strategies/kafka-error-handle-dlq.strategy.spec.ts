import { EachBatchPayload, KafkaMessage, Producer } from 'kafkajs';
import { KafkaErrorHandleDlqStrategy } from './kafka-error-handle-dlq.strategy.js';

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

    await strategy.handle(new TypeError('boom'), batchPayload(), record());

    expect(producer.send).toHaveBeenCalledWith(
      expect.objectContaining({ topic: 'orders.created.dlq' }),
    );
  });

  it('publishes to an explicitly configured dead letter topic', async () => {
    const producer = producerStub();
    const strategy = new KafkaErrorHandleDlqStrategy(producer, 'parking.lot');

    await strategy.handle(new TypeError('boom'), batchPayload(), record());

    expect(producer.send).toHaveBeenCalledWith(
      expect.objectContaining({ topic: 'parking.lot' }),
    );
  });

  it('attaches the original topic and error context as headers', async () => {
    const producer = producerStub();
    const strategy = new KafkaErrorHandleDlqStrategy(producer);

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
    const strategy = new KafkaErrorHandleDlqStrategy(producer);
    const payload = batchPayload();

    await strategy.handle(new TypeError('boom'), payload, record());

    expect(payload.resolveOffset).toHaveBeenCalledWith('7');
  });

  it('describes a thrown non-Error value in the headers', async () => {
    const producer = producerStub();
    const strategy = new KafkaErrorHandleDlqStrategy(producer);

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
    const strategy = new KafkaErrorHandleDlqStrategy(producer);

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
    const strategy = new KafkaErrorHandleDlqStrategy(producer);
    const failed = { ...record(), key: Buffer.from('order-1'), value: Buffer.from('{"a":1}') };

    await strategy.handle(new TypeError('boom'), batchPayload(), failed);

    const sent = (producer.send as jest.Mock).mock.calls[0][0];

    expect(sent.messages[0]).toEqual(
      expect.objectContaining({ key: failed.key, value: failed.value }),
    );
  });
});
