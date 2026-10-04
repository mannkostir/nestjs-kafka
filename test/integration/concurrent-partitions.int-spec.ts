import { Injectable, Module } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { KafkaJS } from '@confluentinc/kafka-javascript';
import { KafkaModule } from '../../src/kafka.module.js';
import { Message } from '../../src/decorators/message-handler.decorator.js';
import { MessageType } from '../../src/types/message.type.js';
import { MessageContext } from '../../src/types/message-context.type.js';
import { startBroker, StartedBroker } from './kafka-broker.js';
import { pause, waitFor } from './wait.js';

const PARTITIONS = [0, 1];
const MESSAGES_PER_PARTITION = 30;
const HANDLING_MS = 100;
const COMPLETION_TIMEOUT_MS = 90000;

type ShipmentCreated = { sequence: number };

class Activity {
  private readonly inHandler = new Set<number>();
  private readonly sequencesByPartition = new Map<number, number[]>();
  private overlapObserved = false;

  get overlapped(): boolean {
    return this.overlapObserved;
  }

  get completed(): number {
    return [...this.sequencesByPartition.values()].reduce((total, list) => total + list.length, 0);
  }

  sequencesOf(partition: number): number[] {
    return this.sequencesByPartition.get(partition) ?? [];
  }

  async handle(partition: number, sequence: number): Promise<void> {
    this.overlapObserved = this.overlapObserved || this.inHandler.size > 0;
    this.inHandler.add(partition);
    await pause(HANDLING_MS);
    this.inHandler.delete(partition);
    this.sequencesByPartition.set(partition, [...this.sequencesOf(partition), sequence]);
  }
}

const concurrentActivity = new Activity();
const sequentialActivity = new Activity();

@Injectable()
class ConcurrentShipmentHandler {
  @Message(['shipments.concurrent'], {
    groupId: 'concurrent-partitions',
    errorHandling: { type: 'fail' },
    consumer: { fromBeginning: true, partitionsConsumedConcurrently: 2 },
  })
  async handle(message: MessageType<ShipmentCreated>, { partition }: MessageContext): Promise<void> {
    await concurrentActivity.handle(partition, message.value?.sequence ?? -1);
  }
}

@Injectable()
class SequentialShipmentHandler {
  @Message(['shipments.sequential'], {
    groupId: 'sequential-partitions',
    errorHandling: { type: 'fail' },
    consumer: { fromBeginning: true },
  })
  async handle(message: MessageType<ShipmentCreated>, { partition }: MessageContext): Promise<void> {
    await sequentialActivity.handle(partition, message.value?.sequence ?? -1);
  }
}

const backlogFor = (partition: number) =>
  Array.from({ length: MESSAGES_PER_PARTITION }, (_, sequence) => ({
    partition,
    value: JSON.stringify({ sequence }),
  }));

const sendBacklog = async (brokers: string[], topic: string): Promise<void> => {
  const producer = new KafkaJS.Kafka({
    kafkaJS: { clientId: 'partition-producer', brokers, logLevel: KafkaJS.logLevel.NOTHING },
  }).producer();

  await producer.connect();

  try {
    await producer.send({ topic, messages: PARTITIONS.flatMap(backlogFor) });
  } finally {
    await producer.disconnect();
  }
};

const inOrder = Array.from({ length: MESSAGES_PER_PARTITION }, (_, sequence) => sequence);

describe('partitions consumed concurrently', () => {
  let broker: StartedBroker;
  let moduleRef: TestingModule;

  beforeAll(async () => {
    broker = await startBroker();
    await broker.createTopics(['shipments.concurrent', 'shipments.sequential'], PARTITIONS.length);
    await sendBacklog(broker.brokers, 'shipments.concurrent');
    await sendBacklog(broker.brokers, 'shipments.sequential');

    @Module({
      imports: [
        KafkaModule.register({
          clientOptions: { kafkaJS: { clientId: 'concurrent-partitions', brokers: broker.brokers } },
          consumerDefaults: { rebalanceTimeout: 20000, sessionTimeout: 10000 },
        }),
      ],
      providers: [ConcurrentShipmentHandler, SequentialShipmentHandler],
    })
    class TestModule {}

    moduleRef = await Test.createTestingModule({ imports: [TestModule] }).compile();

    await moduleRef.init();

    const everyMessage = PARTITIONS.length * MESSAGES_PER_PARTITION;

    await waitFor(
      () => concurrentActivity.completed >= everyMessage && sequentialActivity.completed >= everyMessage,
      COMPLETION_TIMEOUT_MS,
    );
  });

  afterAll(async () => {
    await moduleRef?.close();
    await broker?.stop();
  });

  it('has two partitions inside the handler at the same time when concurrency is 2', () => {
    expect(concurrentActivity.overlapped).toBe(true);
  });

  it('keeps the messages of each partition in order when concurrency is 2', () => {
    expect(PARTITIONS.map((partition) => concurrentActivity.sequencesOf(partition))).toEqual([
      inOrder,
      inOrder,
    ]);
  });

  it('never has two partitions inside the handler at once by default', () => {
    expect(sequentialActivity.overlapped).toBe(false);
  });
});
