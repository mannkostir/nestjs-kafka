import { Injectable, Module } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { KafkaJS } from '@confluentinc/kafka-javascript';
import { KafkaModule } from '../../src/kafka.module.js';
import { Message } from '../../src/decorators/message-handler.decorator.js';
import { MessageBatch } from '../../src/decorators/message-batch-handler.decorator.js';
import { MessageContext } from '../../src/types/message-context.type.js';
import { MessageType } from '../../src/types/message.type.js';
import { ReceivedMessage } from '../../src/types/received-message.type.js';
import { startBroker, StartedBroker } from './kafka-broker.js';
import { eventually, waitFor } from './wait.js';

const sharedConsumer = { fromBeginning: true, allowAutoTopicCreation: true };

const ordersSeen: Array<{ key: string; topic: string }> = [];
const refundsSeen: Array<{ key: string; topic: string }> = [];
let retryThrown = false;

@Injectable()
class OrdersHandler {
  @Message(['shared.orders'], {
    groupId: 'shared-billing',
    sharedGroup: true,
    errorHandling: { type: 'retry', attempts: 1, backoff: { initialMs: 500 } },
    consumer: sharedConsumer,
  })
  async onOrder(message: MessageType, context: MessageContext): Promise<void> {
    ordersSeen.push({ key: String(message.key), topic: context.topic });

    if (String(message.key) === 'retry-me' && !retryThrown) {
      retryThrown = true;
      throw new Error('retry me');
    }
  }
}

@Injectable()
class RefundsIndexer {
  @MessageBatch(['shared.refunds'], {
    groupId: 'shared-billing',
    sharedGroup: true,
    errorHandling: { type: 'fail' },
    consumer: sharedConsumer,
  })
  async index(batch: ReceivedMessage[]): Promise<void> {
    refundsSeen.push(...batch.map(({ message, context }) => ({ key: String(message.key), topic: context.topic })));
  }
}

describe('shared consumer groups', () => {
  let broker: StartedBroker;
  let moduleRef: TestingModule;
  let admin: KafkaJS.Admin;
  let rawProducer: KafkaJS.Producer;

  beforeAll(async () => {
    broker = await startBroker();
    const kafka = new KafkaJS.Kafka({ kafkaJS: { clientId: 'shared-observer', brokers: broker.brokers } });

    await broker.createTopics(['shared.orders', 'shared.refunds'], 2);

    admin = kafka.admin();
    await admin.connect();
    rawProducer = kafka.producer();
    await rawProducer.connect();

    await rawProducer.send({ topic: 'shared.orders', messages: [{ key: 'o1', value: '{}' }, { key: 'retry-me', value: '{}' }] });
    await rawProducer.send({ topic: 'shared.refunds', messages: [{ key: 'r1', value: '{}' }, { key: 'r2', value: '{}' }] });

    @Module({
      imports: [
        KafkaModule.register({
          clientOptions: { kafkaJS: { clientId: 'shared-groups', brokers: broker.brokers } },
          consumerDefaults: { rebalanceTimeout: 20000, sessionTimeout: 10000 },
        }),
      ],
      providers: [OrdersHandler, RefundsIndexer],
    })
    class TestModule {}

    moduleRef = await Test.createTestingModule({ imports: [TestModule] }).compile();
    await moduleRef.init();
  });

  afterAll(async () => {
    await admin?.disconnect();
    await rawProducer?.disconnect();
    await moduleRef?.close();
    await broker?.stop();
  });

  it('hands each handler only its own topic', async () => {
    await waitFor(() => ordersSeen.length >= 2 && refundsSeen.length >= 2);

    expect({
      orders: [...new Set(ordersSeen.map(({ topic }) => topic))].filter((topic) => !topic.includes('.retry.')),
      refunds: [...new Set(refundsSeen.map(({ topic }) => topic))],
    }).toEqual({ orders: ['shared.orders'], refunds: ['shared.refunds'] });
  });

  it('redelivers a failed message from its retry topic to the same handler', async () => {
    await waitFor(() => ordersSeen.some(({ topic }) => topic === 'shared.orders.shared-billing.retry.1'));

    expect(ordersSeen.filter(({ key }) => key === 'retry-me').map(({ topic }) => topic)).toEqual([
      'shared.orders',
      'shared.orders.shared-billing.retry.1',
    ]);
  });

  it('runs the handlers as one consumer group with one member', async () => {
    await eventually(async () => {
      const { groups } = await admin.describeGroups(['shared-billing']);

      expect(groups[0].members).toHaveLength(1);
    });

    const { groups } = await admin.listGroups();

    expect(groups.map(({ groupId }) => groupId)).toEqual(['shared-billing']);
  });
});
