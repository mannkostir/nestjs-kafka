import { Injectable, Module, Type } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { KafkaJS } from '@confluentinc/kafka-javascript';
import { KafkaModule } from '../../src/kafka.module.js';
import { Message } from '../../src/decorators/message-handler.decorator.js';
import { ProducerProxy } from '../../src/base/producer-proxy.js';
import { MessageType } from '../../src/types/message.type.js';
import { MessageFormat } from '../../src/types/message-format.type.js';
import { startBroker, StartedBroker } from './kafka-broker.js';
import { waitFor } from './wait.js';

type InventoryAdjusted = { sku: string; delta: number };
type InvoiceIssued = { invoiceId: string };

const adjusted: MessageType<InventoryAdjusted>[] = [];
const issued: MessageType<InvoiceIssued>[] = [];
const issuedOnTheWire: MessageType[] = [];

const boundedJoin = { rebalanceTimeout: 20000, sessionTimeout: 10000 };

@Injectable()
class InventoryHandler {
  @Message(['inventory.adjusted'], {
    groupId: 'formats-inventory',
    errorHandling: { type: 'fail' },
    consumer: { fromBeginning: true },
  })
  async handle(message: MessageType<InventoryAdjusted>): Promise<void> {
    adjusted.push(message);
  }
}

@Injectable()
class InvoiceWireObserver {
  @Message(['invoices.issued'], {
    groupId: 'formats-invoice-wire',
    errorHandling: { type: 'fail' },
    consumer: { fromBeginning: true },
  })
  async handle(message: MessageType): Promise<void> {
    issuedOnTheWire.push(message);
  }
}

@Injectable()
class InvoiceHandler {
  @Message(['invoices.issued'], {
    groupId: 'formats-invoice',
    errorHandling: { type: 'fail' },
    consumer: { fromBeginning: true },
  })
  async handle(message: MessageType<InvoiceIssued>): Promise<void> {
    issued.push(message);
  }
}

const runningApps = new Set<TestingModule>();

const startApp = async (
  clientId: string,
  brokers: string[],
  handlers: Type[],
  messageFormat?: MessageFormat,
): Promise<TestingModule> => {
  @Module({
    imports: [
      KafkaModule.register({
        clientOptions: { kafkaJS: { clientId, brokers } },
        consumerDefaults: boundedJoin,
        messageFormat,
      }),
    ],
    providers: handlers,
  })
  class FormatsModule {}

  const moduleRef = await Test.createTestingModule({ imports: [FormatsModule] }).compile();

  runningApps.add(moduleRef);
  await moduleRef.init();

  return moduleRef;
};

describe('message formats', () => {
  let broker: StartedBroker;
  let kafka: KafkaJS.Kafka;
  let enveloped: TestingModule;

  beforeAll(async () => {
    broker = await startBroker();
    await broker.createTopics(['inventory.adjusted', 'invoices.issued']);
    kafka = new KafkaJS.Kafka({ kafkaJS: { clientId: 'formats-producer', brokers: broker.brokers } });

    await startApp('formats-raw', broker.brokers, [InventoryHandler, InvoiceWireObserver]);
    enveloped = await startApp(
      'formats-enveloped',
      broker.brokers,
      [InvoiceHandler],
      MessageFormat.ENVELOPED_JSON,
    );
  });

  afterAll(async () => {
    await Promise.allSettled([...runningApps].map((moduleRef) => moduleRef.close()));
    await broker?.stop();
  });

  it('delivers a record from a foreign producer to the handler as-is', async () => {
    const producer = kafka.producer();
    await producer.connect();
    await producer.send({
      topic: 'inventory.adjusted',
      messages: [{ value: JSON.stringify({ sku: 'sku-1', delta: -2 }) }],
    });
    await producer.disconnect();

    await waitFor(() => adjusted.length === 1, 20000);

    expect(adjusted[0].value).toEqual({ sku: 'sku-1', delta: -2 });
  });

  it('round-trips a value through a module that uses the envelope', async () => {
    await enveloped.get(ProducerProxy).send('invoices.issued', {
      key: null,
      value: { invoiceId: 'i-1' },
    });

    await waitFor(() => issued.length === 1, 20000);

    expect(issued[0].value).toEqual({ invoiceId: 'i-1' });
  });

  it('writes the envelope on the wire', async () => {
    await waitFor(() => issuedOnTheWire.length === 1, 20000);

    expect(issuedOnTheWire[0].value).toEqual({ payload: { invoiceId: 'i-1' } });
  });
});
