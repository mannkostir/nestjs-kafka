import { Producer } from 'kafkajs';
import { KafkaProducer } from './kafka-producer';
import { TopicNamespacer } from './topic-namespacer';

const producerStub = () =>
  ({
    connect: jest.fn().mockResolvedValue(undefined),
    disconnect: jest.fn().mockResolvedValue(undefined),
    send: jest.fn().mockResolvedValue([]),
  }) as unknown as Producer;

const message = () => ({
  key: null,
  value: { payload: { orderId: 'o-1' } },
});

describe('KafkaProducer', () => {
  it('sends through the injected producer', async () => {
    const producer = producerStub();

    await new KafkaProducer(producer, new TopicNamespacer()).send(
      'orders.created',
      message(),
    );

    expect(producer.send).toHaveBeenCalledWith(
      expect.objectContaining({ topic: 'orders.created' }),
    );
  });

  it('prefixes the topic with the configured namespace', async () => {
    const producer = producerStub();

    await new KafkaProducer(producer, new TopicNamespacer('dev')).send(
      'orders.created',
      message(),
    );

    expect(producer.send).toHaveBeenCalledWith(
      expect.objectContaining({ topic: 'dev.orders.created' }),
    );
  });

  it('leaves the topic raw when the caller opts out of namespacing', async () => {
    const producer = producerStub();

    await new KafkaProducer(producer, new TopicNamespacer('dev')).send(
      'partner.orders',
      message(),
      { namespaced: false },
    );

    expect(producer.send).toHaveBeenCalledWith(
      expect.objectContaining({ topic: 'partner.orders' }),
    );
  });

  it('passes the key through to the record', async () => {
    const producer = producerStub();

    await new KafkaProducer(producer, new TopicNamespacer()).send(
      'orders.created',
      message(),
      { key: 'order-1' },
    );

    const sent = (producer.send as jest.Mock).mock.calls[0][0];

    expect(sent.messages[0].key).toBe('order-1');
  });

  it('disconnects the injected producer before application shutdown', async () => {
    const producer = producerStub();

    await new KafkaProducer(
      producer,
      new TopicNamespacer(),
    ).beforeApplicationShutdown();

    expect(producer.disconnect).toHaveBeenCalledTimes(1);
  });
});
