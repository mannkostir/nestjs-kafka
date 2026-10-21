import { Injectable, Module } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { KafkaJS } from '@confluentinc/kafka-javascript';
import { KafkaModule } from '../../src/kafka.module.js';
import { Message } from '../../src/decorators/message-handler.decorator.js';
import { KafkaMessage } from '../../src/types/message.type.js';
import { startBroker, StartedBroker } from './kafka-broker.js';
import { eventually, waitFor } from './wait.js';

type OrderPlaced = { orderId: string };

const handled: KafkaMessage<OrderPlaced>[] = [];

@Injectable()
class OrderPlacedHandler {
  @Message(['orders.placed'], {
    groupId: 'orders-reassigned',
    errorHandling: { type: 'fail' },
  })
  async handle(message: KafkaMessage<OrderPlaced>): Promise<void> {
    handled.push(message);
  }
}

const runningApps = new Set<TestingModule>();

const startApp = async (clientId: string, brokers: string[]): Promise<TestingModule> => {
  @Module({
    imports: [KafkaModule.register({ clientOptions: { kafkaJS: { clientId, brokers } } })],
    providers: [OrderPlacedHandler],
  })
  class OrdersModule {}

  const moduleRef = await Test.createTestingModule({ imports: [OrdersModule] }).compile();

  runningApps.add(moduleRef);
  await moduleRef.init();

  return moduleRef;
};

const stopApp = async (moduleRef: TestingModule): Promise<void> => {
  runningApps.delete(moduleRef);
  await moduleRef.close();
};

describe('a partition with no committed offset in a group that has committed on its topic', () => {
  let broker: StartedBroker;
  let kafka: KafkaJS.Kafka;
  let admin: KafkaJS.Admin;

  const produce = async (message: KafkaJS.Message): Promise<void> => {
    const producer = kafka.producer();
    await producer.connect();
    try {
      await producer.send({ topic: 'orders.placed', messages: [message] });
    } finally {
      await producer.disconnect();
    }
  };

  beforeAll(async () => {
    broker = await startBroker();
    await broker.createTopics(['orders.placed'], 2);
    kafka = new KafkaJS.Kafka({
      kafkaJS: { clientId: 'orders-observer', brokers: broker.brokers, logLevel: KafkaJS.logLevel.NOTHING },
    });
    admin = kafka.admin();
    await admin.connect();

    const first = await startApp('orders-first', broker.brokers);

    await produce({ partition: 0, value: JSON.stringify({ orderId: 'o-0' }) });
    await waitFor(() => handled.length === 1, 20000);
    await eventually(async () => {
      const [{ partitions }] = await admin.fetchOffsets({
        groupId: 'orders-reassigned',
        topics: ['orders.placed'],
      });

      expect(partitions).toEqual([expect.objectContaining({ partition: 0, offset: '1' })]);
    });
    await stopApp(first);

    await produce({ partition: 1, value: JSON.stringify({ orderId: 'o-1' }) });
    await startApp('orders-second', broker.brokers);
  });

  afterAll(async () => {
    await Promise.allSettled([...runningApps].map(stopApp));
    await admin?.disconnect();
    await broker?.stop();
  });

  it('is read from its log start by the next member, so a message produced while no member held it is not skipped', async () => {
    await waitFor(() => handled.length === 2, 20000);

    expect(handled.map((message) => message.value)).toEqual([{ orderId: 'o-0' }, { orderId: 'o-1' }]);
  });
});
