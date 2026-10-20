import { Injectable, Logger, Module } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { KafkaJS } from '@confluentinc/kafka-javascript';
import { KafkaModule } from '../../src/kafka.module.js';
import { Message } from '../../src/decorators/message-handler.decorator.js';
import { ProducerProxy } from '../../src/base/producer-proxy.js';
import { startBroker, StartedBroker } from './kafka-broker.js';
import { eventually, waitFor } from './wait.js';

const UNKNOWN_TOPIC_PROPAGATION_MS = 30000;
const FIRST_BACKOFF_MS = 300;

const deliveries: number[] = [];

@Injectable()
class ExplodingInvoiceHandler {
  @Message([/^invoices\.issued$/], {
    groupId: 'dead-letter-backoff',
    errorHandling: { type: 'dlq' },
    consumer: { fromBeginning: true },
  })
  async handle(): Promise<void> {
    deliveries.push(Date.now());
    throw new Error('handler exploded');
  }
}

const gapsBetween = (timestamps: number[]): number[] =>
  timestamps.slice(1).map((timestamp, index) => timestamp - timestamps[index]);

describe('dead letter publish to a missing topic', () => {
  let broker: StartedBroker;
  let moduleRef: TestingModule;
  let admin: KafkaJS.Admin;
  let warn: jest.SpyInstance;

  const committedOffsets = async (): Promise<string[]> => {
    const [{ partitions }] = await admin.fetchOffsets({
      groupId: 'dead-letter-backoff',
      topics: ['invoices.issued'],
    });

    return partitions.map(({ offset }) => offset);
  };

  beforeAll(async () => {
    broker = await startBroker();
    await broker.createTopics(['invoices.issued'], 1);

    admin = new KafkaJS.Kafka({ kafkaJS: { clientId: 'dead-letter-backoff-observer', brokers: broker.brokers } }).admin();
    await admin.connect();

    warn = jest.spyOn(Logger.prototype, 'warn');

    @Module({
      imports: [
        KafkaModule.register({
          clientOptions: {
            kafkaJS: { clientId: 'dead-letter-backoff', brokers: broker.brokers },
            'topic.metadata.refresh.interval.ms': 1000,
          },
          consumerDefaults: { rebalanceTimeout: 20000, sessionTimeout: 10000 },
          producer: { allowAutoTopicCreation: false },
        }),
      ],
      providers: [ExplodingInvoiceHandler],
    })
    class TestModule {}

    moduleRef = await Test.createTestingModule({ imports: [TestModule] }).compile();
    await moduleRef.init();

    await moduleRef.get(ProducerProxy).send('invoices.issued', { key: 'invoice-1', value: { invoiceId: 'i-1' } });

    await waitFor(() => deliveries.length >= 2, UNKNOWN_TOPIC_PROPAGATION_MS * 4);
  }, UNKNOWN_TOPIC_PROPAGATION_MS * 6);

  afterAll(async () => {
    await moduleRef?.close();
    await admin?.disconnect();
    await broker?.stop();
    warn?.mockRestore();
  }, UNKNOWN_TOPIC_PROPAGATION_MS * 3);

  it('logs the failed dead letter publish', () => {
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('Could not publish offset 0 of topic "invoices.issued"'));
  });

  it('logs that the partition is paused before redelivery', () => {
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('Pausing topic "invoices.issued" partition 0'));
  });

  it('redelivers no sooner than the first backoff step', () => {
    expect(Math.min(...gapsBetween(deliveries))).toBeGreaterThanOrEqual(FIRST_BACKOFF_MS - 50);
  });

  it('commits no offset while the dead letter cannot be published', async () => {
    expect(await committedOffsets()).not.toContain('1');
  });

  it('leaves the dead letter topic uncreated', async () => {
    expect(await broker.listTopics()).not.toContain('invoices.issued.dlq');
  });

  it('commits past the record once the dead letter topic exists', async () => {
    await broker.createTopics(['invoices.issued.dlq'], 1);

    await eventually(async () => {
      expect(await committedOffsets()).toEqual(['1']);
    }, UNKNOWN_TOPIC_PROPAGATION_MS * 5);
  }, UNKNOWN_TOPIC_PROPAGATION_MS * 6);
});
