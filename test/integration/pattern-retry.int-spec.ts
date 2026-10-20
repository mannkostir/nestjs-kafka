import { Injectable, Module } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { KafkaJS } from '@confluentinc/kafka-javascript';
import { KafkaModule } from '../../src/kafka.module.js';
import { Message } from '../../src/decorators/message-handler.decorator.js';
import { ProducerProxy } from '../../src/base/producer-proxy.js';
import { MessageType } from '../../src/types/message.type.js';
import { MessageContext } from '../../src/types/message-context.type.js';
import { startBroker, StartedBroker } from './kafka-broker.js';
import { waitFor } from './wait.js';

const deliveries: Array<{ key: string; topic: string }> = [];

@Injectable()
class AuditHandler {
  @Message([/^audit\.[[:alnum:]]+$/], {
    groupId: 'audit-retry',
    errorHandling: { type: 'retry', attempts: 2, backoff: { initialMs: 500 } },
    consumer: { fromBeginning: true },
  })
  async handle(message: MessageType, context: MessageContext): Promise<void> {
    deliveries.push({ key: String(message.key), topic: context.topic });

    if (message.key === 'always-fails') {
      throw new Error('handler exploded');
    }
  }
}

describe('retry on a pattern subscription', () => {
  let broker: StartedBroker;
  let moduleRef: TestingModule;
  let observer: KafkaJS.Consumer;
  const dlqRecords: KafkaJS.KafkaMessage[] = [];

  beforeAll(async () => {
    broker = await startBroker();
    await broker.createTopics(['audit.eu', 'audit.eu.dlq'], 1);

    @Module({
      imports: [
        KafkaModule.register({
          clientOptions: {
            kafkaJS: { clientId: 'pattern-retry', brokers: broker.brokers },
            'topic.metadata.refresh.interval.ms': 1000,
          },
          consumerDefaults: { rebalanceTimeout: 20000, sessionTimeout: 10000, allowAutoTopicCreation: true },
        }),
      ],
      providers: [AuditHandler],
    })
    class TestModule {}

    moduleRef = await Test.createTestingModule({ imports: [TestModule] }).compile();
    await moduleRef.init();

    const kafka = new KafkaJS.Kafka({ kafkaJS: { clientId: 'pattern-retry-observer', brokers: broker.brokers } });
    observer = kafka.consumer({ kafkaJS: { groupId: 'pattern-retry-observer', fromBeginning: true } });
    await observer.connect();
    await observer.subscribe({ topics: ['audit.eu.dlq'] });
    await observer.run({
      eachMessage: async ({ message }) => {
        dlqRecords.push(message);
      },
    });

    await moduleRef.get(ProducerProxy).send('audit.eu', { key: 'always-fails', value: { id: 1 } });

    await waitFor(() => dlqRecords.length > 0, 120000);
  }, 240000);

  afterAll(async () => {
    await observer?.disconnect();
    await moduleRef?.close();
    await broker?.stop();
  });

  it('redelivers through the group retry topics', () => {
    expect(deliveries.filter(({ key }) => key === 'always-fails').map(({ topic }) => topic)).toEqual([
      'audit.eu',
      'audit-retry.retry.1',
      'audit-retry.retry.2',
    ]);
  });

  it('dead-letters under the topic the pattern matched', () => {
    expect(dlqRecords[0].headers?.['dlq.original.topic']?.toString()).toBe('audit.eu');
  });
});
