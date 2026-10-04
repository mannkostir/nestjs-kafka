import { Injectable, Module } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { KafkaJS } from '@confluentinc/kafka-javascript';
import { SchemaType } from '@kafkajs/confluent-schema-registry';
import { KafkaModule } from '../../src/kafka.module.js';
import { Message } from '../../src/decorators/message-handler.decorator.js';
import { ProducerProxy } from '../../src/base/producer-proxy.js';
import { MessageType } from '../../src/types/message.type.js';
import { MessageFormat } from '../../src/types/message-format.type.js';
import {
  startSchemaRegistryBroker,
  StartedSchemaRegistryBroker,
} from './schema-registry-broker.js';
import { waitFor } from './wait.js';

type OrderPlaced = { orderId: string; total: number };
type PaymentCaptured = { paymentId: string; amount: number };
type RefundIssued = { refundId: string };

const NAMESPACE = 'avro';

const placed: MessageType<OrderPlaced>[] = [];
const captured: MessageType<PaymentCaptured>[] = [];
const refunded: MessageType<RefundIssued>[] = [];

const avroConsumer = (groupId: string) => ({
  groupId,
  messageFormat: MessageFormat.AVRO,
  errorHandling: { type: 'fail' as const },
  consumer: { fromBeginning: true, rebalanceTimeout: 20000, sessionTimeout: 10000 },
});

@Injectable()
class OrderPlacedHandler {
  @Message(['orders.placed'], avroConsumer('avro-orders'))
  async handle(message: MessageType<OrderPlaced>): Promise<void> {
    placed.push(message);
  }
}

@Injectable()
class PaymentCapturedHandler {
  @Message(['payments.captured'], avroConsumer('avro-payments'))
  async handle(message: MessageType<PaymentCaptured>): Promise<void> {
    captured.push(message);
  }
}

@Injectable()
class RefundIssuedHandler {
  @Message(['refunds.issued'], avroConsumer('avro-refunds'))
  async handle(message: MessageType<RefundIssued>): Promise<void> {
    refunded.push(message);
  }
}

const orderPlacedSchema = {
  type: 'record',
  name: 'OrderPlaced',
  namespace: 'test',
  fields: [
    { name: 'orderId', type: 'string' },
    { name: 'total', type: 'int' },
  ],
};

const paymentCapturedSchema = {
  type: 'record',
  name: 'PaymentCaptured',
  namespace: 'test',
  fields: [
    { name: 'paymentId', type: 'string' },
    { name: 'amount', type: 'int' },
  ],
};

const refundIssuedSchema = {
  type: 'record',
  name: 'RefundIssued',
  namespace: 'test',
  fields: [{ name: 'refundId', type: 'string' }],
};

const readFirstRawValue = async (brokers: string[], topic: string): Promise<Buffer> => {
  const values: Buffer[] = [];
  const consumer = new KafkaJS.Kafka({
    kafkaJS: { clientId: 'avro-raw-reader', brokers, logLevel: KafkaJS.logLevel.NOTHING },
  }).consumer({ kafkaJS: { groupId: 'avro-raw-reader', fromBeginning: true } });

  await consumer.connect();

  try {
    await consumer.subscribe({ topics: [topic] });
    await consumer.run({
      eachMessage: async ({ message }) => {
        if (message.value) {
          values.push(message.value);
        }
      },
    });
    await waitFor(() => values.length > 0, 30000);

    return values[0];
  } finally {
    await consumer.disconnect();
  }
};

describe('avro producer', () => {
  let broker: StartedSchemaRegistryBroker;
  let moduleRef: TestingModule;
  let orderPlacedSchemaId: number;
  let paymentCapturedSchemaId: number;

  beforeAll(async () => {
    broker = await startSchemaRegistryBroker();

    ({ id: orderPlacedSchemaId } = await broker.registry.register(
      { type: SchemaType.AVRO, schema: JSON.stringify(orderPlacedSchema) },
      { subject: `${NAMESPACE}.orders.placed-value` },
    ));
    ({ id: paymentCapturedSchemaId } = await broker.registry.register(
      { type: SchemaType.AVRO, schema: JSON.stringify(paymentCapturedSchema) },
      { subject: 'payment-captured' },
    ));
    await broker.registry.register(
      { type: SchemaType.AVRO, schema: JSON.stringify(refundIssuedSchema) },
      { subject: 'refund-issued' },
    );

    await broker.createTopics([
      `${NAMESPACE}.orders.placed`,
      `${NAMESPACE}.payments.captured`,
      `${NAMESPACE}.refunds.issued`,
    ]);

    @Module({
      imports: [
        KafkaModule.register({
          clientOptions: { kafkaJS: { clientId: 'avro-producer', brokers: broker.brokers } },
          namespace: NAMESPACE,
          schemaRegistry: { url: broker.registryUrl },
        }),
      ],
      providers: [OrderPlacedHandler, PaymentCapturedHandler, RefundIssuedHandler],
    })
    class AvroModule {}

    moduleRef = await Test.createTestingModule({ imports: [AvroModule] }).compile();

    await moduleRef.init();
  });

  afterAll(async () => {
    await moduleRef?.close();
    await broker?.stop();
  });

  it('round-trips a raw record through the subject named after the namespaced topic', async () => {
    await moduleRef.get(ProducerProxy).send(
      'orders.placed',
      { key: 'order-1', value: { orderId: 'order-1', total: 4200 } },
      { messageFormat: MessageFormat.AVRO },
    );

    await waitFor(() => placed.length === 1, 20000);

    expect({ key: placed[0].key, value: placed[0].value }).toEqual({
      key: 'order-1',
      value: { orderId: 'order-1', total: 4200 },
    });
  });

  it('writes the Confluent wire format with the registered schema id', async () => {
    const raw = await readFirstRawValue(broker.brokers, `${NAMESPACE}.orders.placed`);

    expect({ magicByte: raw.readUInt8(0), schemaId: raw.readInt32BE(1) }).toEqual({
      magicByte: 0,
      schemaId: orderPlacedSchemaId,
    });
  });

  it('round-trips a record encoded with an explicit schema id', async () => {
    await moduleRef.get(ProducerProxy).send(
      'payments.captured',
      { key: 'payment-1', value: { paymentId: 'payment-1', amount: 990 } },
      { messageFormat: MessageFormat.AVRO, schemaId: paymentCapturedSchemaId },
    );

    await waitFor(() => captured.length === 1, 20000);

    expect(captured[0].value).toEqual({ paymentId: 'payment-1', amount: 990 });
  });

  it('round-trips a record encoded with an explicit subject', async () => {
    await moduleRef.get(ProducerProxy).send(
      'refunds.issued',
      { key: 'refund-1', value: { refundId: 'refund-1' } },
      { messageFormat: MessageFormat.AVRO, subject: 'refund-issued' },
    );

    await waitFor(() => refunded.length === 1, 20000);

    expect(refunded[0].value).toEqual({ refundId: 'refund-1' });
  });
});
