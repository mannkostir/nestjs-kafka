import { Injectable, Module } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { KafkaJS } from '@confluentinc/kafka-javascript';
import { KafkaModule } from '../../src/kafka.module.js';
import { Message } from '../../src/decorators/message-handler.decorator.js';
import { ProducerProxy } from '../../src/base/producer-proxy.js';
import { MessageType } from '../../src/types/message.type.js';
import { startBroker, StartedBroker } from './kafka-broker.js';
import { waitFor } from './wait.js';

type OrderCreated = { orderId: string };

const received: MessageType<OrderCreated>[] = [];

@Injectable()
class NamespacedHandler {
  @Message(['orders.created'], {
    groupId: 'namespaced',
    errorHandling: { type: 'fail' },
    consumer: { fromBeginning: true },
  })
  async handle(message: MessageType<OrderCreated>): Promise<void> {
    received.push(message);
  }
}

const audited: MessageType[] = [];

@Injectable()
class AuditHandler {
  @Message([/^audit\..+/], {
    groupId: 'audit',
    errorHandling: { type: 'fail' },
    consumer: { fromBeginning: true },
  })
  async handle(message: MessageType): Promise<void> {
    audited.push(message);
  }
}

describe('namespaced round trip', () => {
  let broker: StartedBroker;
  let moduleRef: TestingModule;

  beforeAll(async () => {
    broker = await startBroker();

    const setup = new KafkaJS.Kafka({
      kafkaJS: { clientId: 'namespace-setup', brokers: broker.brokers },
    }).admin();
    await setup.connect();
    await setup.createTopics({
      topics: [{ topic: 'dev.audit.login' }],
      timeout: 30000,
    });
    await setup.disconnect();

    @Module({
      imports: [
        KafkaModule.register({
          clientOptions: { kafkaJS: { clientId: 'namespaced', brokers: broker.brokers } },
          namespace: 'dev',
          consumerDefaults: { allowAutoTopicCreation: true },
        }),
      ],
      providers: [NamespacedHandler, AuditHandler],
    })
    class TestModule {}

    moduleRef = await Test.createTestingModule({ imports: [TestModule] }).compile();

    await moduleRef.init();
  });

  afterAll(async () => {
    await broker?.stop();
  });

  it('consumes the message it produced under the same namespace', async () => {
    const producer = moduleRef.get(ProducerProxy);

    await producer.send('orders.created', {
      key: null,
      value: { orderId: 'o-1' },
    });

    await waitFor(() => received.length > 0);

    expect(received[0].value).toEqual({ orderId: 'o-1' });
  });

  it('delivers to a pattern handler through the namespaced pattern', async () => {
    const producer = moduleRef.get(ProducerProxy);

    await producer.send('audit.login', {
      key: null,
      value: { userId: 'u-1' },
    });

    await waitFor(() => audited.length > 0);

    expect(audited[0].value).toEqual({ userId: 'u-1' });
  });

  it('writes to the namespaced topic on the broker', async () => {
    const admin = new KafkaJS.Kafka({
      kafkaJS: { clientId: 'namespace-observer', brokers: broker.brokers },
    }).admin();

    await admin.connect();

    const topics = await admin.listTopics();

    await admin.disconnect();

    expect(topics).toContain('dev.orders.created');
    expect(topics).not.toContain('orders.created');
  });

  it('registers the consumer group under the namespace', async () => {
    const admin = new KafkaJS.Kafka({
      kafkaJS: { clientId: 'group-observer', brokers: broker.brokers },
    }).admin();

    await admin.connect();

    const groups = await admin.listGroups();

    await admin.disconnect();

    expect(groups.groups.map((group) => group.groupId)).toContain(
      'dev-namespaced',
    );
  });

  it('disconnects consumers and the producer on shutdown', async () => {
    await expect(moduleRef.close()).resolves.toBeUndefined();
  });

  it('leaves the namespaced consumer group empty after shutdown', async () => {
    const admin = new KafkaJS.Kafka({
      kafkaJS: { clientId: 'shutdown-observer', brokers: broker.brokers },
    }).admin();

    await admin.connect();

    const { groups } = await admin.describeGroups(['dev-namespaced']);

    await admin.disconnect();

    expect(groups).toEqual([
      expect.objectContaining({
        groupId: 'dev-namespaced',
        state: KafkaJS.ConsumerGroupStates.EMPTY,
        members: [],
      }),
    ]);
  });
});
