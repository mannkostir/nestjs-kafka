import { Injectable, Module } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { KafkaJS } from '@confluentinc/kafka-javascript';
import { KafkaModule } from '../../src/kafka.module.js';
import { Message } from '../../src/decorators/message-handler.decorator.js';
import { ProducerProxy } from '../../src/base/producer-proxy.js';
import { MessageType } from '../../src/types/message.type.js';
import { MessageContext } from '../../src/types/message-context.type.js';
import { startBroker, StartedBroker } from './kafka-broker.js';
import { waitFor } from './wait.js';

type Delivery = {
  key: MessageType['key'];
  topic: string;
  at: number;
  headers: Record<string, string | string[]>;
};

const deliveries: Delivery[] = [];

const deliveriesOf = (key: string) => deliveries.filter((delivery) => delivery.key === key);

@Injectable()
class RefundHandler {
  @Message(['refunds.created'], {
    groupId: 'refunds',
    errorHandling: { type: 'retry', attempts: 2, backoff: { initialMs: 1000, multiplier: 2 } },
    consumer: { fromBeginning: true },
  })
  async handle(message: MessageType, context: MessageContext): Promise<void> {
    deliveries.push({
      key: message.key,
      topic: context.topic,
      at: Date.now(),
      headers: message.headers ?? {},
    });

    if (message.key === 'retry-dead') {
      throw new Error('handler exploded');
    }

    if (message.key === 'retry-ok' && deliveriesOf('retry-ok').length <= 2) {
      throw new Error('handler exploded');
    }
  }
}

describe('retry topics', () => {
  let broker: StartedBroker;
  let moduleRef: TestingModule;
  let kafka: KafkaJS.Kafka;
  let observer: KafkaJS.Consumer;
  const dlqRecords: KafkaJS.KafkaMessage[] = [];

  const dlqRecordOf = (key: string) =>
    dlqRecords.find((record) => record.key?.toString() === key);

  beforeAll(async () => {
    broker = await startBroker();
    kafka = new KafkaJS.Kafka({
      kafkaJS: { clientId: 'retry-observer', brokers: broker.brokers },
    });

    await broker.createTopics(['refunds.created', 'refunds.created.dlq']);

    @Module({
      imports: [
        KafkaModule.register({
          clientOptions: { kafkaJS: { clientId: 'retry-topics', brokers: broker.brokers } },
          consumerDefaults: {
            rebalanceTimeout: 20000,
            sessionTimeout: 10000,
            allowAutoTopicCreation: true,
          },
        }),
      ],
      providers: [RefundHandler],
    })
    class TestModule {}

    moduleRef = await Test.createTestingModule({ imports: [TestModule] }).compile();

    await moduleRef.init();

    observer = kafka.consumer({
      kafkaJS: { groupId: 'retry-observer', fromBeginning: true },
    });

    await observer.connect();
    await observer.subscribe({ topics: ['refunds.created.dlq'] });
    await observer.run({
      eachMessage: async ({ message }) => {
        dlqRecords.push(message);
      },
    });

    const producer = moduleRef.get(ProducerProxy);

    await producer.send('refunds.created', { key: 'retry-ok', value: { refundId: 'r-1' } });
    await producer.send('refunds.created', { key: 'flowing', value: { refundId: 'r-2' } });
    await producer.send('refunds.created', { key: 'retry-dead', value: { refundId: 'r-3' } });

    await waitFor(
      () => deliveriesOf('retry-ok').length >= 3 && dlqRecordOf('retry-dead') !== undefined,
      120000,
    );
  }, 240000);

  afterAll(async () => {
    await observer?.disconnect();
    await moduleRef?.close();
    await broker?.stop();
  });

  it('redelivers through each retry topic until the handler succeeds', () => {
    expect(deliveriesOf('retry-ok').map((delivery) => delivery.topic)).toEqual([
      'refunds.created',
      'refunds.created.refunds.retry.1',
      'refunds.created.refunds.retry.2',
    ]);
  });

  it('waits at least the configured delay before each retry', () => {
    const [first, second, third] = deliveriesOf('retry-ok');

    expect([second.at - first.at >= 1000, third.at - second.at >= 2000]).toEqual([true, true]);
  });

  it('exposes the attempt to the handler', () => {
    const lastDelivery = deliveriesOf('retry-ok')[2];

    expect({
      attempt: lastDelivery.headers['retry.attempt'],
      originalTopic: lastDelivery.headers['retry.original.topic'],
    }).toEqual({ attempt: '2', originalTopic: 'refunds.created' });
  });

  it('dead-letters a message whose last retry fails', () => {
    const headers = dlqRecordOf('retry-dead')?.headers ?? {};

    expect({
      originalTopic: headers['dlq.original.topic']?.toString(),
      errorMessage: headers['dlq.error.message']?.toString(),
      attempt: headers['retry.attempt']?.toString(),
    }).toEqual({
      originalTopic: 'refunds.created',
      errorMessage: 'handler exploded',
      attempt: '2',
    });
  });

  it('keeps consuming the source topic while a retry waits', () => {
    const flowing = deliveriesOf('flowing')[0];
    const secondRetryOk = deliveriesOf('retry-ok')[1];

    expect(flowing.at).toBeLessThan(secondRetryOk.at);
  });
});

@Injectable()
class InvoiceHandler {
  @Message(['invoices.created'], {
    groupId: 'invoices',
    errorHandling: { type: 'retry', attempts: 1 },
  })
  async handle(_message: MessageType): Promise<void> {}
}

describe('retry topic provisioning', () => {
  let broker: StartedBroker;
  let moduleRef: TestingModule;

  beforeAll(async () => {
    broker = await startBroker();
    await broker.createTopics(['invoices.created']);

    @Module({
      imports: [
        KafkaModule.register({
          clientOptions: { kafkaJS: { clientId: 'retry-provisioning', brokers: broker.brokers } },
          consumerDefaults: {
            rebalanceTimeout: 20000,
            sessionTimeout: 10000,
            allowAutoTopicCreation: false,
          },
        }),
      ],
      providers: [InvoiceHandler],
    })
    class TestModule {}

    moduleRef = await Test.createTestingModule({ imports: [TestModule] }).compile();
  }, 120000);

  afterAll(async () => {
    await moduleRef?.close().catch(() => undefined);
    await broker?.stop();
  });

  it('fails bootstrap naming the missing retry topic when topic creation is disabled', async () => {
    await expect(moduleRef.init()).rejects.toThrow(/invoices\.created\.invoices\.retry\.1/);
  });
});

const payoutTopics: string[] = [];

@Injectable()
class PayoutHandler {
  @Message(['payouts.created'], {
    groupId: 'payouts',
    errorHandling: { type: 'retry', attempts: 1 },
  })
  async handle(_message: MessageType, context: MessageContext): Promise<void> {
    payoutTopics.push(context.topic);
  }
}

describe('retry topic start offsets', () => {
  let broker: StartedBroker;
  let moduleRef: TestingModule;

  beforeAll(async () => {
    broker = await startBroker();
    await broker.createTopics([
      'payouts.created',
      'payouts.created.payouts.retry.1',
      'payouts.created.dlq',
    ]);

    const producer = new KafkaJS.Kafka({
      kafkaJS: { clientId: 'retry-seeder', brokers: broker.brokers },
    }).producer();

    await producer.connect();
    await producer.send({
      topic: 'payouts.created.payouts.retry.1',
      messages: [
        {
          value: JSON.stringify({ payoutId: 'p-1' }),
          headers: {
            'retry.original.topic': 'payouts.created',
            'retry.attempt': '1',
            'retry.due': String(Date.now()),
          },
        },
      ],
    });
    await producer.disconnect();

    @Module({
      imports: [
        KafkaModule.register({
          clientOptions: { kafkaJS: { clientId: 'retry-start-offsets', brokers: broker.brokers } },
          consumerDefaults: {
            rebalanceTimeout: 20000,
            sessionTimeout: 10000,
          },
        }),
      ],
      providers: [PayoutHandler],
    })
    class TestModule {}

    moduleRef = await Test.createTestingModule({ imports: [TestModule] }).compile();

    await moduleRef.init();
  }, 120000);

  afterAll(async () => {
    await moduleRef?.close();
    await broker?.stop();
  });

  it('reads a retry record produced before the group first joined', async () => {
    await waitFor(() => payoutTopics.length > 0, 30000).catch(() => undefined);

    expect(payoutTopics).toEqual(['payouts.created.payouts.retry.1']);
  });
});
