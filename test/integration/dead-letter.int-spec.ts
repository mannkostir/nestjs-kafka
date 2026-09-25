import { Injectable, Module } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { Kafka, KafkaMessage, Consumer } from 'kafkajs';
import { KafkaModule } from '../../src/kafka.module.js';
import { Message } from '../../src/decorators/message-handler.decorator.js';
import { ProducerProxy } from '../../src/base/producer-proxy.js';
import { MessageType } from '../../src/types/message.type.js';
import { startBroker, StartedBroker } from './kafka-broker.js';

@Injectable()
class ExplodingHandler {
  @Message(['payments.created'], {
    groupId: 'dead-letter',
    errorHandling: { type: 'dlq' },
    consumer: { fromBeginning: true },
  })
  async handle(_message: MessageType): Promise<void> {
    throw new Error('handler exploded');
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

describe('dead letter routing', () => {
  let broker: StartedBroker;
  let moduleRef: TestingModule;
  let kafka: Kafka;
  let observer: Consumer;
  const dlqRecords: KafkaMessage[] = [];

  beforeAll(async () => {
    broker = await startBroker();
    kafka = new Kafka({ clientId: 'dlq-observer', brokers: broker.brokers });

    const admin = kafka.admin();
    await admin.connect();
    await admin.createTopics({ topics: [{ topic: 'payments.created.dlq' }] });
    await admin.disconnect();

    @Module({
      imports: [
        KafkaModule.register({
          clientOptions: { clientId: 'dead-letter', brokers: broker.brokers },
        }),
      ],
      providers: [ExplodingHandler],
    })
    class TestModule {}

    moduleRef = await Test.createTestingModule({ imports: [TestModule] }).compile();

    await moduleRef.init();

    observer = kafka.consumer({ groupId: 'dlq-observer' });

    await observer.connect();
    await observer.subscribe({
      topics: ['payments.created.dlq'],
      fromBeginning: true,
    });
    await observer.run({
      eachMessage: async ({ message }) => {
        dlqRecords.push(message);
      },
    });
  });

  afterAll(async () => {
    await observer?.disconnect();
    await moduleRef?.close();
    await broker?.stop();
  });

  it('publishes a failed record to the suffixed dead letter topic with error context', async () => {
    const producer = moduleRef.get(ProducerProxy);

    await producer.send('payments.created', {
      key: null,
      value: { payload: { paymentId: 'p-1' } },
    });

    await waitFor(() => dlqRecords.length > 0);

    const headers = dlqRecords[0].headers ?? {};

    expect(headers['dlq.original.topic']?.toString()).toBe('payments.created');
    expect(headers['dlq.error.message']?.toString()).toBe('handler exploded');
    expect(headers['dlq.error.name']?.toString()).toBe('Error');
    expect(headers['dlq.timestamp']?.toString()).toEqual(expect.any(String));
  });
});
