import { Injectable, Module } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { KafkaModule } from '../../src/kafka.module.js';
import { Message } from '../../src/decorators/message-handler.decorator.js';
import { ProducerProxy } from '../../src/base/producer-proxy.js';
import { MessageType } from '../../src/types/message.type.js';
import { startBroker, StartedBroker } from './kafka-broker.js';
import { waitFor } from './wait.js';

type InvoiceIssued = { invoiceId: string };

const received: MessageType<InvoiceIssued>[] = [];

@Injectable()
class InvoiceHandler {
  @Message(['invoices.issued'], {
    groupId: 'configured-producer',
    errorHandling: { type: 'fail' },
    consumer: { fromBeginning: true },
  })
  async handle(message: MessageType<InvoiceIssued>): Promise<void> {
    received.push(message);
  }
}

describe('configured producer', () => {
  let broker: StartedBroker;
  let moduleRef: TestingModule;

  beforeAll(async () => {
    broker = await startBroker();
    await broker.createTopics(['invoices.issued']);

    @Module({
      imports: [
        KafkaModule.register({
          clientOptions: { kafkaJS: { clientId: 'configured-producer', brokers: broker.brokers } },
          producer: { idempotent: true, acks: -1, compression: 'gzip' },
        }),
      ],
      providers: [InvoiceHandler],
    })
    class TestModule {}

    moduleRef = await Test.createTestingModule({ imports: [TestModule] }).compile();

    await moduleRef.init();
  });

  afterAll(async () => {
    await moduleRef?.close();
    await broker?.stop();
  });

  it('delivers a message sent by an idempotent, gzip-compressing, all-acks producer', async () => {
    await moduleRef.get(ProducerProxy).send(
      'invoices.issued',
      { key: 'invoice-1', value: { invoiceId: 'i-1' } },
    );

    await waitFor(() => received.length > 0);

    expect(received[0]).toMatchObject({ key: 'invoice-1', value: { invoiceId: 'i-1' } });
  });
});
