import { Injectable, Module } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { KafkaJS } from '@confluentinc/kafka-javascript';
import { KafkaModule } from '../../src/kafka.module.js';
import { Message } from '../../src/decorators/message-handler.decorator.js';
import { ProducerProxy } from '../../src/base/producer-proxy.js';
import { MessageType } from '../../src/types/message.type.js';
import { startBroker, StartedBroker } from './kafka-broker.js';
import { eventually, pause, waitFor } from './wait.js';

type OrderPacked = { orderId: string };

const TOPIC = 'orders.packed';
const GROUP_ID = 'orders-packing';

let received: (string | undefined)[] = [];
let gate: Promise<void> = Promise.resolve();

@Injectable()
class OrderPackedHandler {
  @Message([TOPIC], {
    groupId: GROUP_ID,
    errorHandling: { type: 'fail' },
  })
  async handle(message: MessageType<OrderPacked>): Promise<void> {
    received.push(message.value?.orderId);
    await gate;
  }
}

const runningApps = new Set<TestingModule>();

const startApp = async (clientId: string, brokers: string[]): Promise<TestingModule> => {
  @Module({
    imports: [KafkaModule.register({ clientOptions: { kafkaJS: { clientId, brokers } } })],
    providers: [OrderPackedHandler],
  })
  class PackingModule {}

  const moduleRef = await Test.createTestingModule({ imports: [PackingModule] }).compile();

  runningApps.add(moduleRef);
  await moduleRef.init();

  return moduleRef;
};

const stopApp = async (moduleRef: TestingModule): Promise<void> => {
  runningApps.delete(moduleRef);
  await moduleRef.close();
};

describe('stopping while a handler is mid-batch', () => {
  let broker: StartedBroker;
  let kafka: KafkaJS.Kafka;
  let admin: KafkaJS.Admin | undefined;
  let handledBeforeStop: (string | undefined)[];

  const observer = async (): Promise<KafkaJS.Admin> => {
    if (!admin) {
      admin = kafka.admin();
      await admin.connect();
    }
    return admin;
  };

  beforeAll(async () => {
    broker = await startBroker();
    await broker.createTopics([TOPIC]);
    kafka = new KafkaJS.Kafka({ kafkaJS: { clientId: 'drain-observer', brokers: broker.brokers } });

    const first = await startApp('packing-first', broker.brokers);

    await first.get(ProducerProxy).send(TOPIC, { key: null, value: { orderId: 'warm-up' } });
    await waitFor(() => received.length === 1, 20000);
    await eventually(async () => {
      const [{ partitions }] = await (await observer()).fetchOffsets({
        groupId: GROUP_ID,
        topics: [TOPIC],
      });

      expect(partitions).toEqual([expect.objectContaining({ partition: 0, offset: '1' })]);
    });

    received = [];
    let release: () => void = () => undefined;
    gate = new Promise((resolve) => {
      release = resolve;
    });

    const producer = kafka.producer();
    await producer.connect();
    await producer.send({
      topic: TOPIC,
      messages: ['o-1', 'o-2', 'o-3'].map((orderId) => ({ value: JSON.stringify({ orderId }) })),
    });
    await producer.disconnect();

    await waitFor(() => received.includes('o-1'), 20000);

    runningApps.delete(first);
    const closing = first.close();
    await pause(1000);
    release();
    await closing;

    handledBeforeStop = received;
    received = [];
    gate = Promise.resolve();

    await startApp('packing-second', broker.brokers);
  });

  afterAll(async () => {
    await Promise.allSettled([...runningApps].map(stopApp));
    await admin?.disconnect();
    await broker?.stop();
  });

  it('hands the stopping app only the message already in flight', () => {
    expect(handledBeforeStop).toEqual(['o-1']);
  });

  it('redelivers the rest of the batch to the group after restart', async () => {
    await waitFor(() => received.includes('o-2') && received.includes('o-3'), 20000);

    expect(received).toEqual(expect.arrayContaining(['o-2', 'o-3']));
  });
});
