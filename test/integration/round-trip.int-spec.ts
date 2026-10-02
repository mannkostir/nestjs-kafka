import { Injectable, Module } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { KafkaJS } from '@confluentinc/kafka-javascript';
import { KafkaModule } from '../../src/kafka.module.js';
import { Message } from '../../src/decorators/message-handler.decorator.js';
import { ProducerProxy } from '../../src/base/producer-proxy.js';
import { MessageType } from '../../src/types/message.type.js';
import { startBroker, StartedBroker } from './kafka-broker.js';
import { eventually, waitFor } from './wait.js';

type OrderCreated = { orderId: string };

const received: MessageType<OrderCreated>[] = [];

@Injectable()
class OrderHandler {
  @Message(['orders.created'], {
    groupId: 'round-trip',
    errorHandling: { type: 'fail' },
    consumer: { fromBeginning: true },
  })
  async handle(message: MessageType<OrderCreated>): Promise<void> {
    received.push(message);
  }
}

const highWatermarks = async (
  admin: KafkaJS.Admin,
): Promise<Record<number, string>> => {
  const partitions = await admin.fetchTopicOffsets('orders.created');

  return Object.fromEntries(
    partitions.map(({ partition, high }) => [partition, high]),
  );
};

const committedOffsets = async (
  admin: KafkaJS.Admin,
): Promise<Record<number, string>> => {
  const [{ partitions }] = await admin.fetchOffsets({
    groupId: 'round-trip',
    topics: ['orders.created'],
  });

  return Object.fromEntries(
    partitions.map(({ partition, offset }) => [partition, offset]),
  );
};

describe('produce and consume round trip', () => {
  let broker: StartedBroker;
  let moduleRef: TestingModule;
  let admin: KafkaJS.Admin;

  beforeAll(async () => {
    broker = await startBroker();

    admin = new KafkaJS.Kafka({
      kafkaJS: { clientId: 'offset-observer', brokers: broker.brokers },
    }).admin();

    await admin.connect();

    @Module({
      imports: [
        KafkaModule.register({
          clientOptions: { kafkaJS: { clientId: 'round-trip', brokers: broker.brokers } },
        }),
      ],
      providers: [OrderHandler],
    })
    class TestModule {}

    moduleRef = await Test.createTestingModule({ imports: [TestModule] }).compile();

    await moduleRef.init();
  });

  afterAll(async () => {
    await admin?.disconnect();
    await moduleRef?.close();
    await broker?.stop();
  });

  it('delivers a produced message to the decorated handler', async () => {
    const producer = moduleRef.get(ProducerProxy);

    await producer.send(
      'orders.created',
      { key: 'order-1', value: { orderId: 'o-1' } },
    );

    await waitFor(() => received.length > 0);

    expect(received[0].value).toEqual({ orderId: 'o-1' });
    expect(received[0].key).toBe('order-1');
  });

  it('commits the offset past the delivered message', async () => {
    const produced = await highWatermarks(admin);

    await eventually(async () => {
      expect(await committedOffsets(admin)).toEqual(produced);
    });
  });
});
