import { Producer } from 'kafkajs';
import { KafkaProducer } from './kafka-producer';

const producerStub = () =>
  ({
    connect: jest.fn().mockResolvedValue(undefined),
    disconnect: jest.fn().mockResolvedValue(undefined),
    send: jest.fn().mockResolvedValue([]),
  }) as unknown as Producer;

describe('KafkaProducer', () => {
  it('sends through the injected producer', async () => {
    const producer = producerStub();
    const proxy = new KafkaProducer(producer);

    await proxy.send('orders.created', {
      key: null,
      value: { payload: { orderId: 'o-1' } },
    });

    expect(producer.send).toHaveBeenCalledWith(
      expect.objectContaining({ topic: 'orders.created' }),
    );
  });

  it('prefixes the topic with the configured namespace', async () => {
    const producer = producerStub();
    const proxy = new KafkaProducer(producer, 'dev');

    await proxy.send('orders.created', {
      key: null,
      value: { payload: { orderId: 'o-1' } },
    });

    expect(producer.send).toHaveBeenCalledWith(
      expect.objectContaining({ topic: 'dev.orders.created' }),
    );
  });

  it('disconnects the injected producer on module destroy', async () => {
    const producer = producerStub();
    const proxy = new KafkaProducer(producer);

    await proxy.onModuleDestroy();

    expect(producer.disconnect).toHaveBeenCalledTimes(1);
  });
});
