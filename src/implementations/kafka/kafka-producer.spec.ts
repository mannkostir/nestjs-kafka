import type { KafkaJS } from '@confluentinc/kafka-javascript';
import { MessageFormat } from '../../types/message-format.type.js';
import { KafkaProducer } from './kafka-producer.js';
import { TopicNamespacer } from './topic-namespacer.js';

const producerStub = () =>
  ({
    connect: jest.fn().mockResolvedValue(undefined),
    disconnect: jest.fn().mockResolvedValue(undefined),
    send: jest.fn().mockResolvedValue([]),
  }) as unknown as KafkaJS.Producer;

const message = () => ({
  key: null,
  value: { orderId: 'o-1' },
});

const sentValue = (producer: KafkaJS.Producer) =>
  (producer.send as jest.Mock).mock.calls[0][0].messages[0].value;

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

  it('sends a string message key unchanged', async () => {
    const producer = producerStub();

    await new KafkaProducer(producer, new TopicNamespacer()).send(
      'orders.created',
      { ...message(), key: 'order-1' },
    );

    const sent = (producer.send as jest.Mock).mock.calls[0][0];

    expect(sent.messages[0].key).toBe('order-1');
  });

  it('sends an object message key as JSON', async () => {
    const producer = producerStub();

    await new KafkaProducer(producer, new TopicNamespacer()).send(
      'orders.created',
      { ...message(), key: { tenant: 'acme' } },
    );

    const sent = (producer.send as jest.Mock).mock.calls[0][0];

    expect(sent.messages[0].key).toBe('{"tenant":"acme"}');
  });

  it('disconnects the injected producer before application shutdown', async () => {
    const producer = producerStub();

    await new KafkaProducer(
      producer,
      new TopicNamespacer(),
    ).beforeApplicationShutdown();

    expect(producer.disconnect).toHaveBeenCalledTimes(1);
  });

  it('disconnects through disconnect', async () => {
    const producer = producerStub();

    await new KafkaProducer(producer, new TopicNamespacer()).disconnect();

    expect(producer.disconnect).toHaveBeenCalledTimes(1);
  });

  it('writes the value as JSON without an envelope by default', async () => {
    const producer = producerStub();

    await new KafkaProducer(producer, new TopicNamespacer()).send('orders.created', message());

    expect(sentValue(producer)).toBe('{"orderId":"o-1"}');
  });

  it('writes a null value as a record without a value', async () => {
    const producer = producerStub();

    await new KafkaProducer(producer, new TopicNamespacer()).send('orders.created', {
      key: null,
      value: null,
    });

    expect(sentValue(producer)).toBeNull();
  });

  it('writes with the producer default format', async () => {
    const producer = producerStub();

    await new KafkaProducer(producer, new TopicNamespacer(), {
      messageFormat: MessageFormat.ENVELOPED_JSON,
    }).send('orders.created', message());

    expect(sentValue(producer)).toBe('{"payload":{"orderId":"o-1"}}');
  });

  it('lets the send format override the producer default', async () => {
    const producer = producerStub();

    await new KafkaProducer(producer, new TopicNamespacer(), {
      messageFormat: MessageFormat.ENVELOPED_JSON,
    }).send('orders.created', message(), { messageFormat: MessageFormat.JSON });

    expect(sentValue(producer)).toBe('{"orderId":"o-1"}');
  });

  it('rejects an Avro send without producing anything', async () => {
    const producer = producerStub();

    await expect(
      new KafkaProducer(producer, new TopicNamespacer(), {
        messageFormat: MessageFormat.AVRO,
      }).send('orders.created', message()),
    ).rejects.toThrow('Producing Avro messages is not supported yet.');
    expect(producer.send).not.toHaveBeenCalled();
  });
});
