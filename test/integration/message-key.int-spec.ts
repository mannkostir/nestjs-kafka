import { Module } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { KafkaJS } from '@confluentinc/kafka-javascript';
import { KafkaModule } from '../../src/kafka.module.js';
import { ProducerProxy } from '../../src/base/producer-proxy.js';
import { startBroker, StartedBroker } from './kafka-broker.js';
import { eventually } from './wait.js';

const TOPIC = 'orders.keyed';
const PARTITIONS = 6;

const sortedHighWatermarks = async (admin: KafkaJS.Admin): Promise<string[]> => {
  const partitions = await admin.fetchTopicOffsets(TOPIC);

  return partitions.map(({ high }) => high).sort();
};

describe('message key partitioning', () => {
  let broker: StartedBroker;
  let moduleRef: TestingModule;
  let admin: KafkaJS.Admin;

  beforeAll(async () => {
    broker = await startBroker();

    @Module({
      imports: [
        KafkaModule.register({
          clientOptions: { kafkaJS: { clientId: 'message-key', brokers: broker.brokers } },
        }),
      ],
    })
    class TestModule {}

    moduleRef = await Test.createTestingModule({ imports: [TestModule] }).compile();

    await moduleRef.init();

    admin = new KafkaJS.Kafka({
      kafkaJS: { clientId: 'key-observer', brokers: broker.brokers },
    }).admin();

    await admin.connect();
    await admin.createTopics({
      topics: [{ topic: TOPIC, numPartitions: PARTITIONS }],
      timeout: 30000,
    });
  });

  afterAll(async () => {
    await admin?.disconnect();
    await moduleRef?.close();
    await broker?.stop();
  });

  it('routes messages with the same key to the same partition', async () => {
    const producer = moduleRef.get(ProducerProxy);

    await producer.send(TOPIC, { key: 'order-1', value: { orderId: 'o-1' } });
    await producer.send(TOPIC, { key: 'order-1', value: { orderId: 'o-2' } });

    await eventually(async () => {
      expect(await sortedHighWatermarks(admin)).toEqual(['0', '0', '0', '0', '0', '2']);
    });
  });
});
