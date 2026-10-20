import { Injectable, Module } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { KafkaJS } from '@confluentinc/kafka-javascript';
import { KafkaModule } from '../../src/kafka.module.js';
import { Message } from '../../src/decorators/message-handler.decorator.js';
import { MessageContext } from '../../src/types/message-context.type.js';
import { KafkaMessage } from '../../src/types/message.type.js';
import { startBroker, StartedBroker } from './kafka-broker.js';
import { pause, waitFor } from './wait.js';

const sharedOptions = {
  groupId: 'shared-patterns',
  sharedGroup: true,
  errorHandling: { type: 'fail' as const },
  consumer: { fromBeginning: true, createMissingTopics: true },
};

const seen: Array<{ handler: string; topic: string; key: string }> = [];

@Injectable()
class SpecialHandler {
  @Message(['orders.special'], sharedOptions)
  async handle(message: KafkaMessage, context: MessageContext): Promise<void> {
    seen.push({ handler: 'special', topic: context.topic, key: String(message.key) });
  }
}

@Injectable()
class OrdersHandler {
  @Message([/^orders\..+/], sharedOptions)
  async handle(message: KafkaMessage, context: MessageContext): Promise<void> {
    seen.push({ handler: 'orders', topic: context.topic, key: String(message.key) });
  }
}

@Injectable()
class EuHandler {
  @Message([/^.*(\.eu)$/], sharedOptions)
  async handle(message: KafkaMessage, context: MessageContext): Promise<void> {
    seen.push({ handler: 'eu', topic: context.topic, key: String(message.key) });
  }
}

describe('shared consumer groups with pattern subscriptions', () => {
  let broker: StartedBroker;
  let moduleRef: TestingModule;
  let kafka: KafkaJS.Kafka;
  let rawProducer: KafkaJS.Producer;

  beforeAll(async () => {
    broker = await startBroker();
    kafka = new KafkaJS.Kafka({ kafkaJS: { clientId: 'shared-patterns-observer', brokers: broker.brokers } });

    await broker.createTopics(['orders.special', 'orders.created', 'orders.eu', 'payments.eu'], 1);

    rawProducer = kafka.producer();
    await rawProducer.connect();

    for (const topic of ['orders.special', 'orders.created', 'orders.eu', 'payments.eu']) {
      await rawProducer.send({ topic, messages: [{ key: 'k', value: '{}' }] });
    }

    @Module({
      imports: [
        KafkaModule.register({
          clientOptions: {
            kafkaJS: { clientId: 'shared-group-patterns', brokers: broker.brokers },
            'topic.metadata.refresh.interval.ms': 1000,
          },
          consumerDefaults: { rebalanceTimeout: 20000, sessionTimeout: 10000, createMissingTopics: true },
        }),
      ],
      providers: [SpecialHandler, OrdersHandler, EuHandler],
    })
    class TestModule {}

    moduleRef = await Test.createTestingModule({ imports: [TestModule] }).compile();
    await moduleRef.init();

    await waitFor(() => seen.length >= 3, 60000);
    await pause(5000);
  }, 180000);

  afterAll(async () => {
    await rawProducer?.disconnect();
    await moduleRef?.close();
    await broker?.stop();
  });

  it('lets a concrete claim beat an overlapping pattern', () => {
    expect(seen.filter(({ topic }) => topic === 'orders.special').map(({ handler }) => handler)).toEqual(['special']);
  });

  it('routes a topic matched by one pattern to its handler', () => {
    expect(seen.filter(({ topic }) => topic === 'orders.created').map(({ handler }) => handler)).toEqual(['orders']);
  });

  it('keeps an unambiguous topic flowing next to an ambiguous one', () => {
    expect(seen.filter(({ topic }) => topic === 'payments.eu').map(({ handler }) => handler)).toEqual(['eu']);
  });

  it('delivers nothing from a topic two patterns match', () => {
    expect(seen.filter(({ topic }) => topic === 'orders.eu')).toEqual([]);
  });

  it('commits no progress for a topic two patterns match', async () => {
    const admin = kafka.admin();
    await admin.connect();
    const offsets = await admin.fetchOffsets({ groupId: 'shared-patterns', topics: ['orders.eu'] });
    await admin.disconnect();

    expect(offsets[0].partitions[0].offset).toBe('0');
  });
});
