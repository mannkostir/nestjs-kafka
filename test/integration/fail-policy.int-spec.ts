import { Injectable, Module } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { KafkaJS } from '@confluentinc/kafka-javascript';
import { KafkaModule } from '../../src/kafka.module.js';
import { Message } from '../../src/decorators/message-handler.decorator.js';
import { ProducerProxy } from '../../src/base/producer-proxy.js';
import { MessageType } from '../../src/types/message.type.js';
import { startBroker, StartedBroker } from './kafka-broker.js';
import { eventually, waitFor } from './wait.js';

type InvoiceCreated = { invoiceId: string };

const attempts: MessageType<InvoiceCreated>[] = [];

@Injectable()
class FlakyInvoiceHandler {
  @Message(['invoices.created'], {
    groupId: 'fail-policy',
    errorHandling: { type: 'fail' },
    consumer: { fromBeginning: true },
  })
  async handle(message: MessageType<InvoiceCreated>): Promise<void> {
    attempts.push(message);

    if (attempts.length === 1) {
      throw new Error('transient failure');
    }
  }
}

describe('fail policy', () => {
  let broker: StartedBroker;
  let moduleRef: TestingModule;
  let admin: KafkaJS.Admin;

  beforeAll(async () => {
    broker = await startBroker();
    await broker.createTopics(['invoices.created']);

    admin = new KafkaJS.Kafka({
      kafkaJS: { clientId: 'fail-observer', brokers: broker.brokers },
    }).admin();
    await admin.connect();

    @Module({
      imports: [
        KafkaModule.register({
          clientOptions: { kafkaJS: { clientId: 'fail-policy', brokers: broker.brokers } },
        }),
      ],
      providers: [FlakyInvoiceHandler],
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

  it('redelivers a message whose handler threw', async () => {
    await moduleRef.get(ProducerProxy).send('invoices.created', {
      key: null,
      value: { invoiceId: 'i-1' },
    });

    await waitFor(() => attempts.length >= 2);

    expect(attempts[1].value).toEqual({ invoiceId: 'i-1' });
  });

  it('commits past the message once a delivery succeeds', async () => {
    await eventually(async () => {
      const [{ partitions }] = await admin.fetchOffsets({
        groupId: 'fail-policy',
        topics: ['invoices.created'],
      });

      expect(partitions.map(({ offset }) => offset)).toEqual(['1']);
    });
  });
});
