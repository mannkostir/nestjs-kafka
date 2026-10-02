import type { KafkaJS } from '@confluentinc/kafka-javascript';
import { Logger } from '@nestjs/common';
import { KafkaConsumer } from './kafka-consumer.js';
import { KafkaTopicProvisioner } from './kafka-topic-provisioner.js';
import { TopicNamespacer } from './topic-namespacer.js';
import { MessageFormat } from '../../types/message-format.type.js';
import { KafkaMessageParseStrategyFactory } from './parse-strategies/kafka-message-parse-strategy.factory.js';

const consumerStub = () => ({
  connect: jest.fn().mockResolvedValue(undefined),
  subscribe: jest.fn().mockResolvedValue(undefined),
  run: jest.fn().mockResolvedValue(undefined),
  disconnect: jest.fn().mockResolvedValue(undefined),
});

const provisionerStub = () => ({
  createMissing: jest.fn().mockResolvedValue(undefined),
  assertExisting: jest.fn().mockResolvedValue(undefined),
});

const kafkaStub = (consumer: ReturnType<typeof consumerStub>) => {
  const kafka = {
    consumer: jest.fn().mockReturnValue(consumer),
    admin: jest.fn().mockReturnValue({
      connect: jest.fn().mockResolvedValue(undefined),
      disconnect: jest.fn().mockResolvedValue(undefined),
      listTopics: jest.fn().mockResolvedValue([]),
      createTopics: jest.fn().mockResolvedValue(true),
      fetchTopicMetadata: jest.fn(async ({ topics }: { topics: string[] }) =>
        topics.map((name) => ({ name, partitions: [{ partitionId: 0, leader: 1 }] })),
      ),
    }),
  } as unknown as KafkaJS.Kafka;

  consumer.run.mockImplementation(async () => {
    const config = (kafka.consumer as jest.Mock).mock.calls.at(-1)[0];
    await config.rebalance_cb({ code: -175 }, []);
  });

  return kafka;
};

const flush = () => new Promise((resolve) => setImmediate(resolve));

const consumerConfig = (kafka: KafkaJS.Kafka) =>
  (kafka.consumer as jest.Mock).mock.calls[0][0].kafkaJS;

const subscription = () => ({
  topicPatterns: ['orders.created'],
  messageFormat: MessageFormat.JSON,
  errorHandling: { type: 'ignore' as const },
});

describe('KafkaConsumer group id', () => {
  it('uses the bare group id when no namespace is configured', async () => {
    const consumer = consumerStub();
    const kafka = kafkaStub(consumer);

    await new KafkaConsumer(kafka).subscribe(
      subscription(),
      jest.fn(),
      'orders-service',
    );

    expect(consumerConfig(kafka)).toEqual(
      expect.objectContaining({ groupId: 'orders-service' }),
    );
  });

  it('prefixes the group id with the namespace', async () => {
    const consumer = consumerStub();
    const kafka = kafkaStub(consumer);

    await new KafkaConsumer(kafka, { namespace: 'dev' }).subscribe(
      subscription(),
      jest.fn(),
      'orders-service',
    );

    expect(consumerConfig(kafka)).toEqual(
      expect.objectContaining({ groupId: 'dev-orders-service' }),
    );
  });
});

describe('KafkaConsumer configuration precedence', () => {
  it('falls back to the built-in defaults', async () => {
    const consumer = consumerStub();
    const kafka = kafkaStub(consumer);

    await new KafkaConsumer(kafka).subscribe(
      subscription(),
      jest.fn(),
      'orders-service',
    );

    expect(consumerConfig(kafka)).toEqual(
      expect.objectContaining({
        allowAutoTopicCreation: true,
        fromBeginning: false,
      }),
    );
  });

  it('omits settings left unset at every level so the client defaults apply', async () => {
    const consumer = consumerStub();
    const kafka = kafkaStub(consumer);

    await new KafkaConsumer(kafka).subscribe(
      subscription(),
      jest.fn(),
      'orders-service',
    );

    expect(Object.keys(consumerConfig(kafka)).sort()).toEqual([
      'allowAutoTopicCreation',
      'fromBeginning',
      'groupId',
      'logger',
      'retry',
    ]);
  });

  it('applies module level consumer defaults over the built-in defaults', async () => {
    const consumer = consumerStub();
    const kafka = kafkaStub(consumer);

    await new KafkaConsumer(kafka, {
      consumerDefaults: { heartbeatInterval: 1000, fromBeginning: true },
    }).subscribe(subscription(), jest.fn(), 'orders-service');

    expect(consumerConfig(kafka)).toEqual(
      expect.objectContaining({ heartbeatInterval: 1000, fromBeginning: true }),
    );
  });

  it('applies per handler overrides over module level defaults', async () => {
    const consumer = consumerStub();
    const kafka = kafkaStub(consumer);

    await new KafkaConsumer(kafka, {
      consumerDefaults: { heartbeatInterval: 1000, sessionTimeout: 20000 },
    }).subscribe(
      { ...subscription(), consumer: { heartbeatInterval: 500 } },
      jest.fn(),
      'orders-service',
    );

    expect(consumerConfig(kafka)).toEqual(
      expect.objectContaining({
        heartbeatInterval: 500,
        sessionTimeout: 20000,
      }),
    );
  });

  it('merges retry options shallowly across module and handler levels', async () => {
    const consumer = consumerStub();
    const kafka = kafkaStub(consumer);

    await new KafkaConsumer(kafka, {
      consumerDefaults: { retry: { maxRetryTime: 5000, initialRetryTime: 100 } },
    }).subscribe(
      { ...subscription(), consumer: { retry: { maxRetryTime: 2000 } } },
      jest.fn(),
      'orders-service',
    );

    expect(consumerConfig(kafka).retry).toEqual({
      maxRetryTime: 2000,
      initialRetryTime: 100,
    });
  });

  it('subscribes without a per subscription fromBeginning flag', async () => {
    const consumer = consumerStub();
    const kafka = kafkaStub(consumer);

    await new KafkaConsumer(kafka, {
      consumerDefaults: { fromBeginning: true },
    }).subscribe(subscription(), jest.fn(), 'orders-service');

    expect(consumer.subscribe.mock.calls[0][0]).not.toHaveProperty('fromBeginning');
  });
});

describe('KafkaConsumer topic namespacing', () => {
  it('subscribes to the namespaced topic', async () => {
    const consumer = consumerStub();
    const kafka = kafkaStub(consumer);

    await new KafkaConsumer(kafka, {
      namespace: 'dev',
      namespacer: new TopicNamespacer('dev'),
    }).subscribe(subscription(), jest.fn(), 'orders-service');

    expect(consumer.subscribe).toHaveBeenCalledWith(
      expect.objectContaining({ topics: ['dev.orders.created'] }),
    );
  });

  it('subscribes to the raw topic when the handler opts out', async () => {
    const consumer = consumerStub();
    const kafka = kafkaStub(consumer);

    await new KafkaConsumer(kafka, {
      namespace: 'dev',
      namespacer: new TopicNamespacer('dev'),
    }).subscribe(
      { ...subscription(), namespaced: false },
      jest.fn(),
      'orders-service',
    );

    expect(consumer.subscribe).toHaveBeenCalledWith(
      expect.objectContaining({ topics: ['orders.created'] }),
    );
  });

  it('namespaces a pattern subscription', async () => {
    const consumer = consumerStub();
    const kafka = kafkaStub(consumer);

    await new KafkaConsumer(kafka, {
      namespace: 'dev',
      namespacer: new TopicNamespacer('dev'),
    }).subscribe(
      { ...subscription(), topicPatterns: [/^orders\..*/] },
      jest.fn(),
      'orders-service',
    );

    const topics = (consumer.subscribe as jest.Mock).mock.calls[0][0].topics;

    expect((topics[0] as RegExp).source).toBe('^dev\\.(orders\\..*)');
  });

  it('namespaces an explicitly configured dead letter topic', async () => {
    const consumer = consumerStub();
    const kafka = kafkaStub(consumer);
    const producer = {
      send: jest.fn().mockResolvedValue([]),
    } as unknown as KafkaJS.Producer;

    const subject = new KafkaConsumer(kafka, {
      namespace: 'dev',
      namespacer: new TopicNamespacer('dev'),
      producer,
    });

    await subject.subscribe(
      {
        ...subscription(),
        errorHandling: { type: 'dlq', topic: 'parking.lot' },
      },
      jest.fn().mockRejectedValue(new Error('boom')),
      'orders-service',
    );

    const eachBatch = (consumer.run as jest.Mock).mock.calls[0][0].eachBatch;

    await eachBatch({
      batch: {
        topic: 'dev.orders.created',
        messages: [
          {
            key: null,
            value: Buffer.from(JSON.stringify({ payload: {} })),
            timestamp: '0',
            size: 0,
            attributes: 0,
            offset: '0',
          },
        ],
      },
      isRunning: () => true,
      isStale: () => false,
      resolveOffset: jest.fn(),
    });

    expect(producer.send).toHaveBeenCalledWith(
      expect.objectContaining({ topic: 'dev.parking.lot' }),
    );
  });
});

describe('KafkaConsumer parse strategy resolution', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('resolves the parse strategy once per subscription rather than per message', async () => {
    const consumer = consumerStub();
    const kafka = kafkaStub(consumer);

    const subject = new KafkaConsumer(kafka);
    const resolve = jest.spyOn(KafkaMessageParseStrategyFactory.prototype, 'create');

    await subject.subscribe(subscription(), jest.fn(), 'orders-service');

    const eachBatch = (consumer.run as jest.Mock).mock.calls[0][0].eachBatch;

    await eachBatch({
      batch: {
        topic: 'orders.created',
        messages: [
          {
            key: null,
            value: Buffer.from(JSON.stringify({ payload: {} })),
            timestamp: '0',
            size: 0,
            attributes: 0,
            offset: '0',
          },
          {
            key: null,
            value: Buffer.from(JSON.stringify({ payload: {} })),
            timestamp: '0',
            size: 0,
            attributes: 0,
            offset: '1',
          },
        ],
      },
      isRunning: () => true,
      isStale: () => false,
      resolveOffset: jest.fn(),
    });

    expect(resolve).toHaveBeenCalledTimes(1);
  });
});

describe('KafkaConsumer configuration errors', () => {
  it('rejects an avro subscription when no schema registry is configured', async () => {
    const consumer = consumerStub();
    const kafka = kafkaStub(consumer);

    await expect(
      new KafkaConsumer(kafka).subscribe(
        { ...subscription(), messageFormat: MessageFormat.AVRO },
        jest.fn(),
        'orders-service',
      ),
    ).rejects.toThrow(/Avro message format requires a Schema Registry/);
    expect(kafka.consumer).not.toHaveBeenCalled();
  });

  it('rejects a dlq subscription when no producer is available', async () => {
    const consumer = consumerStub();
    const kafka = kafkaStub(consumer);

    await expect(
      new KafkaConsumer(kafka).subscribe(
        { ...subscription(), errorHandling: { type: 'dlq' } },
        jest.fn(),
        'orders-service',
      ),
    ).rejects.toThrow(/DLQ error handling requires a producer/);
    expect(kafka.consumer).not.toHaveBeenCalled();
  });

  it('rejects a pattern librdkafka cannot match before creating a consumer', async () => {
    const consumer = consumerStub();
    const kafka = kafkaStub(consumer);

    await expect(
      new KafkaConsumer(kafka).subscribe(
        { ...subscription(), topicPatterns: [/^orders/i] },
        jest.fn(),
        'orders-service',
      ),
    ).rejects.toThrow(/Topic pattern \/\^orders\/i cannot be subscribed/);
    expect(kafka.consumer).not.toHaveBeenCalled();
  });

  it('rejects a namespaced string topic starting with ^ before provisioning it', async () => {
    const consumer = consumerStub();
    const kafka = kafkaStub(consumer);

    await expect(
      new KafkaConsumer(kafka, {
        namespace: 'dev',
        namespacer: new TopicNamespacer('dev'),
      }).subscribe(
        { ...subscription(), topicPatterns: ['^orders'] },
        jest.fn(),
        'orders-service',
      ),
    ).rejects.toThrow(/Topic "\^orders" cannot be subscribed/);
    expect(kafka.admin).not.toHaveBeenCalled();
    expect(kafka.consumer).not.toHaveBeenCalled();
  });
});

describe('KafkaConsumer group assignment', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('resolves subscribe only after the first assignment', async () => {
    const consumer = consumerStub();
    const kafka = kafkaStub(consumer);
    let releaseRun!: () => void;
    consumer.run.mockImplementation(
      () => new Promise<void>((resolve) => { releaseRun = resolve; }),
    );

    let resolved = false;
    const subscribePromise = new KafkaConsumer(kafka)
      .subscribe(subscription(), jest.fn(), 'orders-service')
      .then(() => {
        resolved = true;
      });

    await flush();
    releaseRun();
    await flush();

    expect(resolved).toBe(false);

    const config = (kafka.consumer as jest.Mock).mock.calls.at(-1)[0];
    await config.rebalance_cb({ code: -175 }, []);
    await subscribePromise;

    expect(resolved).toBe(true);
  });

  it('does not wait for an assignment when every topic is a pattern', async () => {
    const consumer = consumerStub();
    const kafka = kafkaStub(consumer);
    consumer.run.mockImplementation(() => Promise.resolve());

    await expect(
      new KafkaConsumer(kafka).subscribe(
        { ...subscription(), topicPatterns: [/^audit\..+/] },
        jest.fn(),
        'audit-service',
      ),
    ).resolves.toBeUndefined();
  });

  it('rejects naming the group and closes the consumer when no assignment arrives', async () => {
    jest.useFakeTimers();
    const consumer = consumerStub();
    const kafka = kafkaStub(consumer);
    consumer.run.mockImplementation(() => Promise.resolve());

    const subscribePromise = new KafkaConsumer(kafka).subscribe(
      { ...subscription(), consumer: { rebalanceTimeout: 1000, sessionTimeout: 500 } },
      jest.fn(),
      'orders-service',
    );

    const assertion = expect(subscribePromise).rejects.toThrow(
      /Consumer group "orders-service" received no partition assignment within 1500 ms/,
    );

    await jest.advanceTimersByTimeAsync(1500);
    await assertion;

    expect(consumer.disconnect).toHaveBeenCalledTimes(1);
  });
});

describe('KafkaConsumer client logging', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('hands the client consumer a logger that forwards to the supplied client logger', async () => {
    const consumer = consumerStub();
    const kafka = kafkaStub(consumer);
    const clientLogger = {
      info: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn(),
      namespace: jest.fn(),
      setLogLevel: jest.fn(),
    };
    await new KafkaConsumer(kafka, { clientLogger }).subscribe(
      subscription(),
      jest.fn(),
      'orders-service',
    );

    consumerConfig(kafka).logger.info('joined group');

    expect(clientLogger.info).toHaveBeenCalledWith('joined group', undefined);
  });

  it('subscribes with a default client logger when none is supplied', async () => {
    const consumer = consumerStub();
    const kafka = kafkaStub(consumer);

    const nestLog = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    await new KafkaConsumer(kafka).subscribe(subscription(), jest.fn(), 'orders-service');

    consumerConfig(kafka).logger.info('x');

    expect(nestLog).toHaveBeenCalledWith('x');
  });
});

describe('KafkaConsumer cleanup on failed subscribe', () => {
  it('disconnects the consumer and rethrows the original error', async () => {
    const consumer = consumerStub();
    const originalError = Object.assign(new Error('not authorized'), {
      type: 'TOPIC_AUTHORIZATION_FAILED',
    });
    consumer.subscribe.mockRejectedValue(originalError);
    const kafka = kafkaStub(consumer);

    await expect(
      new KafkaConsumer(kafka).subscribe(
        subscription(),
        jest.fn(),
        'orders-service',
      ),
    ).rejects.toBe(originalError);

    expect(consumer.disconnect).toHaveBeenCalledTimes(1);
  });
});

describe('KafkaConsumer shutdown', () => {
  it('disconnects every subscribed consumer when the module is destroyed', async () => {
    const consumer = consumerStub();
    const kafkaConsumer = new KafkaConsumer(kafkaStub(consumer));
    await kafkaConsumer.subscribe(subscription(), jest.fn(), 'orders-service');
    await kafkaConsumer.subscribe(subscription(), jest.fn(), 'audit-service');

    await kafkaConsumer.onModuleDestroy();

    expect(consumer.disconnect).toHaveBeenCalledTimes(2);
  });

  it('disconnectAll leaves nothing for onModuleDestroy to disconnect', async () => {
    const consumer = consumerStub();
    const kafkaConsumer = new KafkaConsumer(kafkaStub(consumer));
    await kafkaConsumer.subscribe(subscription(), jest.fn(), 'orders-service');

    await kafkaConsumer.disconnectAll();
    await kafkaConsumer.onModuleDestroy();

    expect(consumer.disconnect).toHaveBeenCalledTimes(1);
  });
});

describe('KafkaConsumer topic provisioning', () => {
  it('creates the namespaced string topics before creating the consumer', async () => {
    const consumer = consumerStub();
    const kafka = kafkaStub(consumer);
    const topicProvisioner = provisionerStub();
    topicProvisioner.createMissing.mockImplementation(async () => {
      expect(kafka.consumer).not.toHaveBeenCalled();
    });

    await new KafkaConsumer(kafka, {
      namespace: 'dev',
      namespacer: new TopicNamespacer('dev'),
      topicProvisioner: topicProvisioner as unknown as KafkaTopicProvisioner,
    }).subscribe(
      { ...subscription(), topicPatterns: ['orders.created', /^audit\..+/] },
      jest.fn(),
      'orders-service',
    );

    expect(topicProvisioner.createMissing).toHaveBeenCalledWith(['dev.orders.created']);
  });

  it('only checks existence when auto topic creation is disabled', async () => {
    const consumer = consumerStub();
    const kafka = kafkaStub(consumer);
    const topicProvisioner = provisionerStub();

    await new KafkaConsumer(kafka, {
      topicProvisioner: topicProvisioner as unknown as KafkaTopicProvisioner,
    }).subscribe(
      { ...subscription(), consumer: { allowAutoTopicCreation: false } },
      jest.fn(),
      'orders-service',
    );

    expect(topicProvisioner.assertExisting).toHaveBeenCalledWith(['orders.created']);
    expect(topicProvisioner.createMissing).not.toHaveBeenCalled();
  });

  it('creates no consumer when a required topic is missing', async () => {
    const consumer = consumerStub();
    const kafka = kafkaStub(consumer);
    const topicProvisioner = provisionerStub();
    topicProvisioner.assertExisting.mockRejectedValue(new Error('missing'));

    await expect(
      new KafkaConsumer(kafka, {
        topicProvisioner: topicProvisioner as unknown as KafkaTopicProvisioner,
      }).subscribe(
        { ...subscription(), consumer: { allowAutoTopicCreation: false } },
        jest.fn(),
        'orders-service',
      ),
    ).rejects.toThrow('missing');
    expect(kafka.consumer).not.toHaveBeenCalled();
  });
});

describe('KafkaConsumer fail error handling', () => {
  const failingMessage = (offset: string) => ({
    key: null,
    value: Buffer.from(JSON.stringify({ payload: {} })),
    timestamp: '0',
    size: 0,
    attributes: 0,
    offset,
  });

  const failingBatch = (resume: () => void) => ({
    batch: { topic: 'orders.created', partition: 0, messages: [failingMessage('7')] },
    isRunning: () => true,
    isStale: () => false,
    resolveOffset: jest.fn(),
    pause: jest.fn(() => resume),
  });

  const eachBatchOf = (consumer: ReturnType<typeof consumerStub>, call = 0) =>
    (consumer.run as jest.Mock).mock.calls[call][0].eachBatch;

  const failingHandler = () => jest.fn().mockRejectedValue(new Error('handler exploded'));

  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('pauses the failing partition and rethrows by default', async () => {
    const consumer = consumerStub();
    await new KafkaConsumer(kafkaStub(consumer)).subscribe(
      { ...subscription(), errorHandling: { type: 'fail' } },
      failingHandler(),
      'orders-service',
    );
    const batch = failingBatch(jest.fn());

    await expect(eachBatchOf(consumer)(batch)).rejects.toThrow('handler exploded');

    expect(batch.pause).toHaveBeenCalledTimes(1);
  });

  it('does not pause the partition when backoff is disabled', async () => {
    const consumer = consumerStub();
    await new KafkaConsumer(kafkaStub(consumer)).subscribe(
      { ...subscription(), errorHandling: { type: 'fail', backoff: false } },
      failingHandler(),
      'orders-service',
    );
    const batch = failingBatch(jest.fn());

    await expect(eachBatchOf(consumer)(batch)).rejects.toThrow('handler exploded');

    expect(batch.pause).not.toHaveBeenCalled();
  });

  it('rejects invalid backoff options before connecting a consumer', async () => {
    const consumer = consumerStub();
    const kafka = kafkaStub(consumer);

    await expect(
      new KafkaConsumer(kafka).subscribe(
        { ...subscription(), errorHandling: { type: 'fail', backoff: { initialMs: 0 } } },
        jest.fn(),
        'orders-service',
      ),
    ).rejects.toThrow(/Invalid fail backoff/);
    expect(kafka.consumer).not.toHaveBeenCalled();
  });

  it('keeps redelivery attempts independent between subscriptions', async () => {
    const consumer = consumerStub();
    const kafkaConsumer = new KafkaConsumer(kafkaStub(consumer));
    const failSubscription = { ...subscription(), errorHandling: { type: 'fail' as const } };
    await kafkaConsumer.subscribe(failSubscription, failingHandler(), 'orders-service');
    await kafkaConsumer.subscribe(failSubscription, failingHandler(), 'audit-service');
    await eachBatchOf(consumer, 0)(failingBatch(jest.fn())).catch(() => undefined);
    const resume = jest.fn();

    await eachBatchOf(consumer, 1)(failingBatch(resume)).catch(() => undefined);
    await jest.advanceTimersByTimeAsync(300);

    expect(resume).toHaveBeenCalledTimes(1);
  });

  it('never resumes a paused partition after every consumer is disconnected', async () => {
    const consumer = consumerStub();
    const kafkaConsumer = new KafkaConsumer(kafkaStub(consumer));
    await kafkaConsumer.subscribe(
      { ...subscription(), errorHandling: { type: 'fail' } },
      failingHandler(),
      'orders-service',
    );
    const resume = jest.fn();
    await eachBatchOf(consumer)(failingBatch(resume)).catch(() => undefined);

    await kafkaConsumer.disconnectAll();
    await jest.advanceTimersByTimeAsync(30000);

    expect(resume).not.toHaveBeenCalled();
  });

  it('stops the redelivery backoff before disconnecting the consumer', async () => {
    const consumer = consumerStub();
    const kafkaConsumer = new KafkaConsumer(kafkaStub(consumer));
    await kafkaConsumer.subscribe(
      { ...subscription(), errorHandling: { type: 'fail' } },
      failingHandler(),
      'orders-service',
    );
    const eachBatch = eachBatchOf(consumer);
    const batch = failingBatch(jest.fn());
    consumer.disconnect.mockImplementation(async () => {
      await eachBatch(batch).catch(() => undefined);
    });

    await kafkaConsumer.disconnectAll();

    expect(batch.pause).not.toHaveBeenCalled();
  });

  it('stops the redelivery backoff of a subscription that fails to start', async () => {
    const consumer = consumerStub();
    const kafka = kafkaStub(consumer);
    let eachBatch!: (payload: unknown) => Promise<void>;
    consumer.run.mockImplementation(async (config: { eachBatch: typeof eachBatch }) => {
      eachBatch = config.eachBatch;
      throw new Error('run failed');
    });
    const batch = failingBatch(jest.fn());
    consumer.disconnect.mockImplementation(async () => {
      await eachBatch(batch).catch(() => undefined);
    });

    await new KafkaConsumer(kafka)
      .subscribe({ ...subscription(), errorHandling: { type: 'fail' } }, failingHandler(), 'orders-service')
      .catch(() => undefined);

    expect(batch.pause).not.toHaveBeenCalled();
  });
});

describe('KafkaConsumer message format precedence', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  const subscriptionWithoutFormat = {
    topicPatterns: ['orders.created'],
    errorHandling: { type: 'ignore' as const },
  };

  it('parses as JSON when neither the subscription nor the consumer sets a format', async () => {
    const create = jest.spyOn(KafkaMessageParseStrategyFactory.prototype, 'create');

    await new KafkaConsumer(kafkaStub(consumerStub())).subscribe(
      subscriptionWithoutFormat,
      jest.fn(),
      'orders-service',
    );

    expect(create).toHaveBeenCalledWith(MessageFormat.JSON);
  });

  it('parses with the consumer default format when the subscription sets none', async () => {
    const create = jest.spyOn(KafkaMessageParseStrategyFactory.prototype, 'create');

    await new KafkaConsumer(kafkaStub(consumerStub()), {
      messageFormat: MessageFormat.ENVELOPED_JSON,
    }).subscribe(subscriptionWithoutFormat, jest.fn(), 'orders-service');

    expect(create).toHaveBeenCalledWith(MessageFormat.ENVELOPED_JSON);
  });

  it('lets the subscription format override the consumer default', async () => {
    const create = jest.spyOn(KafkaMessageParseStrategyFactory.prototype, 'create');

    await new KafkaConsumer(kafkaStub(consumerStub()), {
      messageFormat: MessageFormat.ENVELOPED_JSON,
    }).subscribe(
      { ...subscriptionWithoutFormat, messageFormat: MessageFormat.JSON },
      jest.fn(),
      'orders-service',
    );

    expect(create).toHaveBeenCalledWith(MessageFormat.JSON);
  });
});
