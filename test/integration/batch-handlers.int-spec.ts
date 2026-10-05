import { Injectable, Module } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { KafkaJS } from '@confluentinc/kafka-javascript';
import { KafkaModule } from '../../src/kafka.module.js';
import { MessageBatch } from '../../src/decorators/message-batch-handler.decorator.js';
import { BatchFailure } from '../../src/errors/batch-failure.js';
import { ProducerProxy } from '../../src/base/producer-proxy.js';
import { ReceivedMessage } from '../../src/types/received-message.type.js';
import { startBroker, StartedBroker } from './kafka-broker.js';
import { eventually, waitFor } from './wait.js';

const backlogSize = 200;
const keys200 = Array.from({ length: backlogSize }, (_, index) => `k${String(index).padStart(3, '0')}`);

const bulk: string[][] = [];

@Injectable()
class BulkIndexer {
  @MessageBatch(['batch.bulk'], {
    groupId: 'batch-bulk',
    errorHandling: { type: 'fail' },
    consumer: { fromBeginning: true },
  })
  async index(batch: ReceivedMessage[]): Promise<void> {
    bulk.push(batch.map(({ message }) => String(message.key)));
  }
}

const partialHandled: string[] = [];

@Injectable()
class PartialIndexer {
  @MessageBatch(['batch.partial'], {
    groupId: 'batch-partial',
    errorHandling: { type: 'dlq' },
    consumer: { fromBeginning: true },
  })
  async index(batch: ReceivedMessage[]): Promise<void> {
    const poison = batch.findIndex(({ message }) => message.key === 'poison');
    const handled = poison === -1 ? batch : batch.slice(0, poison);
    partialHandled.push(...handled.map(({ message }) => String(message.key)));

    if (poison !== -1) {
      throw new BatchFailure(poison, new Error('poison record'));
    }
  }
}

const failSeen: string[] = [];
let failThrown = false;

@Injectable()
class FlakyIndexer {
  @MessageBatch(['batch.fail'], {
    groupId: 'batch-fail',
    errorHandling: { type: 'fail', backoff: { initialMs: 200 } },
    consumer: { fromBeginning: true },
  })
  async index(batch: ReceivedMessage[]): Promise<void> {
    failSeen.push(...batch.map(({ message }) => String(message.key)));

    if (!failThrown && batch.some(({ message }) => message.key === 'flaky')) {
      failThrown = true;
      throw new Error('flaky once');
    }
  }
}

const retryTopicsSeen: Array<{ key: string; topic: string }> = [];
let retryThrown = false;

@Injectable()
class RetryingIndexer {
  @MessageBatch(['batch.retry'], {
    groupId: 'batch-retry',
    errorHandling: { type: 'retry', attempts: 1, backoff: { initialMs: 500 } },
    consumer: { fromBeginning: true, allowAutoTopicCreation: true },
  })
  async index(batch: ReceivedMessage[]): Promise<void> {
    retryTopicsSeen.push(
      ...batch.map(({ message, context }) => ({ key: String(message.key), topic: context.topic })),
    );
    const target = batch.findIndex(({ message }) => message.key === 'retry-me');

    if (!retryThrown && target !== -1) {
      retryThrown = true;
      throw new BatchFailure(target, new Error('retry me'));
    }
  }
}

describe('batch handlers', () => {
  let broker: StartedBroker;
  let moduleRef: TestingModule;
  let kafka: KafkaJS.Kafka;
  let admin: KafkaJS.Admin;
  let rawProducer: KafkaJS.Producer;
  let observer: KafkaJS.Consumer;
  let producer: ProducerProxy;
  const dlqKeys: string[] = [];

  beforeAll(async () => {
    broker = await startBroker();
    kafka = new KafkaJS.Kafka({
      kafkaJS: { clientId: 'batch-observer', brokers: broker.brokers },
    });

    await broker.createTopics(['batch.bulk', 'batch.partial', 'batch.partial.dlq', 'batch.fail', 'batch.retry'], 1);

    admin = kafka.admin();
    await admin.connect();

    rawProducer = kafka.producer();
    await rawProducer.connect();
    await rawProducer.send({
      topic: 'batch.bulk',
      messages: keys200.map((key) => ({ key, value: JSON.stringify({}) })),
    });

    @Module({
      imports: [
        KafkaModule.register({
          clientOptions: { kafkaJS: { clientId: 'batch-handlers', brokers: broker.brokers } },
          consumerDefaults: { rebalanceTimeout: 20000, sessionTimeout: 10000 },
        }),
      ],
      providers: [BulkIndexer, PartialIndexer, FlakyIndexer, RetryingIndexer],
    })
    class TestModule {}

    moduleRef = await Test.createTestingModule({ imports: [TestModule] }).compile();

    await moduleRef.init();

    producer = moduleRef.get(ProducerProxy);

    observer = kafka.consumer({
      kafkaJS: { groupId: 'batch-dlq-observer', fromBeginning: true },
    });

    await observer.connect();
    await observer.subscribe({ topics: ['batch.partial.dlq'] });
    await observer.run({
      eachMessage: async ({ message }) => {
        dlqKeys.push(String(message.key));
      },
    });
  });

  afterAll(async () => {
    await observer?.disconnect();
    await admin?.disconnect();
    await rawProducer?.disconnect();
    await moduleRef?.close();
    await broker?.stop();
  });

  it('delivers a backlog in order, in batches of more than one message', async () => {
    await waitFor(() => bulk.flat().length >= backlogSize);

    expect({
      inOrder: bulk.flat().slice(0, backlogSize).join(',') === keys200.join(','),
      batched: Math.max(...bulk.map((batch) => batch.length)) > 1,
    }).toEqual({ inOrder: true, batched: true });
  });

  it('commits the offsets of a handled batch', async () => {
    await waitFor(() => bulk.flat().length >= backlogSize);

    await eventually(async () => {
      const [{ partitions }] = await admin.fetchOffsets({
        groupId: 'batch-bulk',
        topics: ['batch.bulk'],
      });

      expect(partitions).toEqual([expect.objectContaining({ partition: 0, offset: String(backlogSize) })]);
    });
  });

  it('dead-letters only the record a BatchFailure names', async () => {
    await producer.send('batch.partial', { key: 'a', value: {} });
    await producer.send('batch.partial', { key: 'poison', value: {} });
    await producer.send('batch.partial', { key: 'b', value: {} });

    await waitFor(() => partialHandled.includes('b') && dlqKeys.length > 0);

    expect({ dlq: dlqKeys, handled: [...new Set(partialHandled)].sort() }).toEqual({
      dlq: ['poison'],
      handled: ['a', 'b'],
    });
  });

  it('redelivers a batch whose handler failed under the fail policy', async () => {
    await producer.send('batch.fail', { key: 'flaky', value: {} });

    await waitFor(() => failSeen.filter((key) => key === 'flaky').length >= 2);

    expect(failSeen.filter((key) => key === 'flaky').length).toBeGreaterThanOrEqual(2);
  });

  it('retries a failed record from its retry topic', async () => {
    await producer.send('batch.retry', { key: 'retry-me', value: {} });

    await waitFor(() =>
      retryTopicsSeen.some(({ key, topic }) => key === 'retry-me' && topic.endsWith('.retry.1')),
    );

    expect(retryTopicsSeen.filter(({ key }) => key === 'retry-me').map(({ topic }) => topic)).toEqual([
      'batch.retry',
      'batch.retry.batch-retry.retry.1',
    ]);
  });
});
