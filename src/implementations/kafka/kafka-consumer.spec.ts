import { Kafka, Producer } from 'kafkajs';
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
        heartbeatInterval: 30000,
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
