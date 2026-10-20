import { KafkaConnections } from './kafka-connections.js';
import { KafkaConsumer } from './kafka-consumer.js';
import { KafkaProducer } from './kafka-producer.js';
import { MessageType } from '../../types/message.type.js';

describe('KafkaConnections', () => {
  it('disconnects consumers before the producer', async () => {
    const order: string[] = [];
    const consumer = {
      disconnectAll: jest.fn(async () => {
        order.push('consumers');
      }),
    } as unknown as KafkaConsumer<MessageType>;
    const producer = {
      disconnect: jest.fn(async () => {
        order.push('producer');
      }),
    } as unknown as KafkaProducer;

    await new KafkaConnections(consumer, producer).releaseConnections();

    expect(order).toEqual(['consumers', 'producer']);
  });

  it('disconnects the producer once when released twice', async () => {
    const consumer = {
      disconnectAll: jest.fn().mockResolvedValue(undefined),
    } as unknown as KafkaConsumer<MessageType>;
    const disconnect = jest.fn().mockResolvedValue(undefined);
    const producer = { disconnect } as unknown as KafkaProducer;
    const connections = new KafkaConnections(consumer, producer);

    await connections.releaseConnections();
    await connections.releaseConnections();

    expect(disconnect).toHaveBeenCalledTimes(1);
  });

  it('disconnects the consumers once when released concurrently', async () => {
    const disconnectAll = jest.fn().mockResolvedValue(undefined);
    const consumer = { disconnectAll } as unknown as KafkaConsumer<MessageType>;
    const producer = {
      disconnect: jest.fn().mockResolvedValue(undefined),
    } as unknown as KafkaProducer;
    const connections = new KafkaConnections(consumer, producer);

    await Promise.all([
      connections.releaseConnections(),
      connections.releaseConnections(),
    ]);

    expect(disconnectAll).toHaveBeenCalledTimes(1);
  });
});
