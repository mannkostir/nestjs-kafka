import { Test } from '@nestjs/testing';
import { Kafka, Producer } from 'kafkajs';
import { ConsumerProxy } from '../../base/consumer-proxy.js';
import { ProducerProxy } from '../../base/producer-proxy.js';
import { MessageFormat } from '../../types/message-format.type.js';
import { KafkaConsumer } from './kafka-consumer.js';
import { KafkaProducer } from './kafka-producer.js';
import { TopicNamespacer } from './topic-namespacer.js';

describe('Kafka connector shutdown order', () => {
  it('disconnects consumers before the producer when the application closes', async () => {
    const disconnected: string[] = [];
    const consumer = {
      connect: jest.fn().mockResolvedValue(undefined),
      subscribe: jest.fn().mockResolvedValue(undefined),
      run: jest.fn().mockResolvedValue(undefined),
      disconnect: jest.fn(async () => {
        disconnected.push('consumer');
      }),
    };
    const producer = {
      disconnect: jest.fn(async () => {
        disconnected.push('producer');
      }),
    } as unknown as Producer;
    const kafka = { consumer: () => consumer } as unknown as Kafka;
    const moduleRef = await Test.createTestingModule({
      providers: [
        {
          provide: ProducerProxy,
          useValue: new KafkaProducer(producer, new TopicNamespacer()),
        },
        { provide: ConsumerProxy, useValue: new KafkaConsumer(kafka) },
      ],
    }).compile();
    await moduleRef.get(ConsumerProxy).subscribe(
      {
        topicPatterns: ['orders.created'],
        messageFormat: MessageFormat.JSON,
        errorHandling: { type: 'ignore' },
      },
      jest.fn(),
      'orders-service',
    );

    await moduleRef.close();

    expect(disconnected).toEqual(['consumer', 'producer']);
  });
});
