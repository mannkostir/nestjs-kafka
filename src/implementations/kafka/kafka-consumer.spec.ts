import { Kafka, Producer } from 'kafkajs';
import { Logger } from '@nestjs/common';
import { KafkaConsumer } from './kafka-consumer';
import { TopicNamespacer } from './topic-namespacer';
import { MessageFormat } from '../../types/message-format.type';

const consumerStub = () => ({
  connect: jest.fn().mockResolvedValue(undefined),
  subscribe: jest.fn().mockResolvedValue(undefined),
  run: jest.fn().mockResolvedValue(undefined),
  disconnect: jest.fn().mockResolvedValue(undefined),
});

const kafkaStub = (consumer: ReturnType<typeof consumerStub>) =>
  ({ consumer: jest.fn().mockReturnValue(consumer) }) as unknown as Kafka;

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

    expect(kafka.consumer).toHaveBeenCalledWith(
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

    expect(kafka.consumer).toHaveBeenCalledWith(
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

    expect(kafka.consumer).toHaveBeenCalledWith(
      expect.objectContaining({
        heartbeatInterval: undefined,
        allowAutoTopicCreation: true,
      }),
    );
    expect(consumer.subscribe).toHaveBeenCalledWith(
      expect.objectContaining({ fromBeginning: false }),
    );
  });

  it('applies module level consumer defaults over the built-in defaults', async () => {
    const consumer = consumerStub();
    const kafka = kafkaStub(consumer);

    await new KafkaConsumer(kafka, {
      consumerDefaults: { heartbeatInterval: 1000, fromBeginning: true },
    }).subscribe(subscription(), jest.fn(), 'orders-service');

    expect(kafka.consumer).toHaveBeenCalledWith(
      expect.objectContaining({ heartbeatInterval: 1000 }),
    );
    expect(consumer.subscribe).toHaveBeenCalledWith(
      expect.objectContaining({ fromBeginning: true }),
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

    expect(kafka.consumer).toHaveBeenCalledWith(
      expect.objectContaining({
        heartbeatInterval: 500,
        sessionTimeout: 20000,
      }),
    );
  });

  it('merges retry options shallowly across all three levels', async () => {
    const consumer = consumerStub();
    const kafka = kafkaStub(consumer);

    await new KafkaConsumer(kafka, {
      consumerDefaults: { retry: { retries: 5, initialRetryTime: 100 } },
    }).subscribe(
      { ...subscription(), consumer: { retry: { retries: 2 } } },
      jest.fn(),
      'orders-service',
    );

    const config = (kafka.consumer as jest.Mock).mock.calls[0][0];

    expect(config.retry.retries).toBe(2);
    expect(config.retry.initialRetryTime).toBe(100);
    expect(config.retry.maxRetryTime).toBe(30000);
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

    expect((topics[0] as RegExp).source).toBe('^dev\\.(?:orders\\..*)');
  });

  it('namespaces an explicitly configured dead letter topic', async () => {
    const consumer = consumerStub();
    const kafka = kafkaStub(consumer);
    const producer = {
      send: jest.fn().mockResolvedValue([]),
    } as unknown as Producer;

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
      jest.fn(),
      'orders-service',
    );

    const strategy = (subject as unknown as {
      strategyCache: Map<string, { handle: Function }>;
    }).strategyCache.get('dlq:dev.parking.lot');

    expect(strategy).toBeDefined();
  });
});

describe('KafkaConsumer parse strategy resolution', () => {
  it('resolves the parse strategy once per subscription rather than per message', async () => {
    const consumer = consumerStub();
    const kafka = kafkaStub(consumer);

    const subject = new KafkaConsumer(kafka);
    const resolve = jest.spyOn(
      subject as unknown as { getParseStrategy: (...args: unknown[]) => unknown },
      'getParseStrategy',
    );

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
      heartbeat: jest.fn().mockResolvedValue(undefined),
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
  });
});

describe('KafkaConsumer topic creation at subscribe', () => {
  const topicAwaitingCreationError = () =>
    Object.assign(new Error('This server does not host this topic-partition'), {
      type: 'UNKNOWN_TOPIC_OR_PARTITION',
    });

  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('retries once and succeeds', async () => {
    const consumer = consumerStub();
    consumer.subscribe
      .mockRejectedValueOnce(topicAwaitingCreationError())
      .mockResolvedValueOnce(undefined);
    const kafka = kafkaStub(consumer);

    const result = new KafkaConsumer(kafka).subscribe(
      subscription(),
      jest.fn(),
      'orders-service',
    );

    await jest.advanceTimersByTimeAsync(1000);

    await expect(result).resolves.toBeUndefined();
    expect(consumer.subscribe).toHaveBeenCalledTimes(2);
  });

  it('does not retry when auto topic creation is disabled', async () => {
    const consumer = consumerStub();
    consumer.subscribe.mockRejectedValue(topicAwaitingCreationError());
    const kafka = kafkaStub(consumer);

    const result = new KafkaConsumer(kafka).subscribe(
      { ...subscription(), consumer: { allowAutoTopicCreation: false } },
      jest.fn(),
      'orders-service',
    );

    await expect(result).rejects.toThrow();

    expect(consumer.subscribe).toHaveBeenCalledTimes(1);
  });

  it('gives up after five retries', async () => {
    const consumer = consumerStub();
    consumer.subscribe.mockRejectedValue(topicAwaitingCreationError());
    const kafka = kafkaStub(consumer);

    const result = new KafkaConsumer(kafka).subscribe(
      subscription(),
      jest.fn(),
      'orders-service',
    );
    const assertion = expect(result).rejects.toThrow();

    await jest.advanceTimersByTimeAsync(3000);
    await assertion;

    expect(consumer.subscribe).toHaveBeenCalledTimes(6);
  });

  it('does not retry for other errors', async () => {
    const consumer = consumerStub();
    consumer.subscribe.mockRejectedValue(
      Object.assign(new Error('not authorized'), { type: 'TOPIC_AUTHORIZATION_FAILED' }),
    );
    const kafka = kafkaStub(consumer);

    const result = new KafkaConsumer(kafka).subscribe(
      subscription(),
      jest.fn(),
      'orders-service',
    );

    await expect(result).rejects.toThrow();

    expect(consumer.subscribe).toHaveBeenCalledTimes(1);
  });

  it('logs a warning on each retry', async () => {
    const consumer = consumerStub();
    consumer.subscribe
      .mockRejectedValueOnce(topicAwaitingCreationError())
      .mockRejectedValueOnce(topicAwaitingCreationError())
      .mockResolvedValueOnce(undefined);
    const kafka = kafkaStub(consumer);
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

    const result = new KafkaConsumer(kafka).subscribe(
      subscription(),
      jest.fn(),
      'orders-service',
    );

    await jest.advanceTimersByTimeAsync(1000);
    await result;

    expect(warn).toHaveBeenCalledTimes(2);
    expect(warn.mock.calls[0][0]).toContain('orders.created');

    warn.mockRestore();
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
});
