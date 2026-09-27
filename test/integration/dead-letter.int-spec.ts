import { Injectable, Module } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { KafkaJS } from '@confluentinc/kafka-javascript';
import { KafkaModule } from '../../src/kafka.module.js';
import { Message } from '../../src/decorators/message-handler.decorator.js';
import { ProducerProxy } from '../../src/base/producer-proxy.js';
import { MessageType } from '../../src/types/message.type.js';
import { startBroker, StartedBroker } from './kafka-broker.js';
import { waitFor } from './wait.js';

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

describe('dead letter routing', () => {
  let broker: StartedBroker;
  let moduleRef: TestingModule;
  let kafka: KafkaJS.Kafka;
  let observer: KafkaJS.Consumer;
  const dlqRecords: KafkaJS.KafkaMessage[] = [];

  beforeAll(async () => {
    broker = await startBroker();
    kafka = new KafkaJS.Kafka({
      kafkaJS: { clientId: 'dlq-observer', brokers: broker.brokers },
    });

    const admin = kafka.admin();
    await admin.connect();
    await admin.createTopics({
      topics: [{ topic: 'payments.created.dlq' }],
      timeout: 30000,
    });
    await admin.disconnect();

    @Module({
      imports: [
        KafkaModule.register({
          clientOptions: { kafkaJS: { clientId: 'dead-letter', brokers: broker.brokers } },
        }),
      ],
      providers: [ExplodingHandler],
    })
    class TestModule {}

    moduleRef = await Test.createTestingModule({ imports: [TestModule] }).compile();

    await moduleRef.init();

    observer = kafka.consumer({
      kafkaJS: { groupId: 'dlq-observer', fromBeginning: true },
    });

    await observer.connect();
    await observer.subscribe({ topics: ['payments.created.dlq'] });
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

    await producer.send(
      'payments.created',
      { key: null, value: { payload: { paymentId: 'p-1' } } },
      { key: 'payment-1' },
    );

    await waitFor(() => dlqRecords.length > 0);

    const headers = dlqRecords[0].headers ?? {};

    expect(headers['dlq.original.topic']?.toString()).toBe('payments.created');
    expect(headers['dlq.error.message']?.toString()).toBe('handler exploded');
    expect(headers['dlq.error.name']?.toString()).toBe('Error');
    expect(headers['dlq.timestamp']?.toString()).toEqual(expect.any(String));
  });

  it('keeps the failed record key and value on the dead letter copy', async () => {
    await waitFor(() => dlqRecords.length > 0);

    expect(dlqRecords[0].key?.toString()).toBe('payment-1');
    expect(JSON.parse(dlqRecords[0].value?.toString() ?? 'null')).toEqual({
      payload: { paymentId: 'p-1' },
    });
  });
});
