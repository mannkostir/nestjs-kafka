import { Test } from '@nestjs/testing';
import { Logger } from '@nestjs/common';
import type { KafkaJS } from '@confluentinc/kafka-javascript';
import { ConsumerProxy } from '../../base/consumer-proxy.js';
import { ProducerProxy } from '../../base/producer-proxy.js';
import { MessageFormat } from '../../types/message-format.type.js';
import { KafkaConsumer, KafkaConsumerOptions } from './kafka-consumer.js';
import { KafkaProducer } from './kafka-producer.js';
import { TopicNamespacer } from './topic-namespacer.js';

const subscribedConnector = async (
  consumerDisconnect: () => Promise<void>,
  consumerOptions?: KafkaConsumerOptions,
) => {
  const disconnected: string[] = [];
  const consumer = {
    connect: jest.fn().mockResolvedValue(undefined),
    subscribe: jest.fn().mockResolvedValue(undefined),
    run: jest.fn().mockResolvedValue(undefined),
    disconnect: jest.fn(async () => {
      await consumerDisconnect();
      disconnected.push('consumer');
    }),
  };
  const producer = {
    disconnect: jest.fn(async () => {
      disconnected.push('producer');
    }),
  } as unknown as KafkaJS.Producer;
  const kafka = {
    consumer: jest.fn(() => consumer),
    admin: () => ({
      connect: jest.fn().mockResolvedValue(undefined),
      disconnect: jest.fn().mockResolvedValue(undefined),
      listTopics: jest.fn().mockResolvedValue(['orders.created']),
      createTopics: jest.fn().mockResolvedValue(true),
      fetchTopicMetadata: jest.fn(async ({ topics }: { topics: string[] }) =>
        topics.map((name) => ({ name, partitions: [{ partitionId: 0, leader: 1 }] })),
      ),
    }),
  } as unknown as KafkaJS.Kafka;
  consumer.run.mockImplementation(async () => {
    const config = (kafka.consumer as jest.Mock).mock.calls.at(-1)[0];
    await config.rebalance_cb({ code: -175 }, []);
  });
  const moduleRef = await Test.createTestingModule({
    providers: [
      {
        provide: ProducerProxy,
        useValue: new KafkaProducer(producer, new TopicNamespacer()),
      },
      { provide: ConsumerProxy, useValue: new KafkaConsumer(kafka, consumerOptions) },
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
  return { moduleRef, disconnected };
};

describe('Kafka connector shutdown order', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('disconnects consumers before the producer when the application closes', async () => {
    const { moduleRef, disconnected } = await subscribedConnector(async () => undefined);

    await moduleRef.close();

    expect(disconnected).toEqual(['consumer', 'producer']);
  });

  it('still disconnects the producer when a consumer disconnect outlasts the shutdown timeout', async () => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const { moduleRef, disconnected } = await subscribedConnector(
      () => new Promise<void>(() => undefined),
      { shutdownTimeout: 50 },
    );

    await moduleRef.close();

    expect(disconnected).toEqual(['producer']);
  });
});
