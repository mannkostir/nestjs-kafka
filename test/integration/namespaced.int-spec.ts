import { Injectable, Module } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { Kafka } from 'kafkajs';
import { KafkaModule } from '../../src/kafka.module.js';
import { Message } from '../../src/decorators/message-handler.decorator.js';
import { ProducerProxy } from '../../src/base/producer-proxy.js';
import { MessageType } from '../../src/types/message.type.js';
import { startBroker, StartedBroker } from './kafka-broker.js';

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

const waitFor = async (
  predicate: () => boolean,
  timeoutMs = 60000,
): Promise<void> => {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (predicate()) {
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  throw new Error('Timed out waiting for the expected condition');
};

describe('namespaced round trip', () => {
  let broker: StartedBroker;
  let moduleRef: TestingModule;

  beforeAll(async () => {
    broker = await startBroker();

    @Module({
      imports: [
        KafkaModule.register({
          clientOptions: { clientId: 'namespaced', brokers: broker.brokers },
          namespace: 'dev',
        }),
      ],
      providers: [NamespacedHandler],
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
      value: { payload: { orderId: 'o-1' } },
    });

    await waitFor(() => received.length > 0);

    expect(received[0].value?.payload).toEqual({ orderId: 'o-1' });
  });

  it('writes to the namespaced topic on the broker', async () => {
    const admin = new Kafka({
      clientId: 'namespace-observer',
      brokers: broker.brokers,
    }).admin();

    await admin.connect();

    const topics = await admin.listTopics();

    await admin.disconnect();

    expect(topics).toContain('dev.orders.created');
    expect(topics).not.toContain('orders.created');
  });

  it('registers the consumer group under the namespace', async () => {
    const admin = new Kafka({
      clientId: 'group-observer',
      brokers: broker.brokers,
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
    const admin = new Kafka({
      clientId: 'shutdown-observer',
      brokers: broker.brokers,
    }).admin();

    await admin.connect();

    const { groups } = await admin.describeGroups(['dev-namespaced']);

    await admin.disconnect();

    expect(groups).toEqual([
      expect.objectContaining({
        groupId: 'dev-namespaced',
        state: 'Empty',
        members: [],
      }),
    ]);
  });
});
