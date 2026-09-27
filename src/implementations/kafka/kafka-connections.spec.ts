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
    } as unknown as KafkaProducer<Record<string, unknown>>;

    await new KafkaConnections(consumer, producer).releaseConnections();

    expect(order).toEqual(['consumers', 'producer']);
  });
});
