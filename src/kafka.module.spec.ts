import { DynamicModule } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { KafkaJS } from '@confluentinc/kafka-javascript';
import { SchemaRegistry } from '@kafkajs/confluent-schema-registry';
import { KafkaModule } from './kafka.module.js';
import { KafkaModuleOptions } from './types/kafka-module-options.type.js';
import { IReleaseConnections } from './interfaces/release-connections.interface.js';
import { KAFKA_PRODUCER, KAFKA_CONNECTIONS, BATCH_CONSUMER, SHARED_GROUP_CONSUMER } from './tokens.js';
import { ConsumerProxy } from './base/consumer-proxy.js';
import { ProducerProxy } from './base/producer-proxy.js';
import { MessageFormat } from './types/message-format.type.js';
import { ProducerCompression } from './types/producer-config.type.js';
import { KafkaMessageParseStrategyFactory } from './implementations/kafka/parse-strategies/kafka-message-parse-strategy.factory.js';

jest.mock('@kafkajs/confluent-schema-registry', () => ({
  SchemaRegistry: jest.fn(),
}));

const clientOptions = { kafkaJS: { brokers: ['localhost:9092'] } };

const producerStub = () => ({
  connect: jest.fn().mockResolvedValue(undefined),
  disconnect: jest.fn().mockResolvedValue(undefined),
  send: jest.fn().mockResolvedValue([]),
});

const compileWith = (options: KafkaModuleOptions) =>
  Test.createTestingModule({ imports: [KafkaModule.register(options)] })
    .overrideProvider(KAFKA_PRODUCER)
    .useValue(producerStub())
    .compile();

const compileAsyncWith = (options: KafkaModuleOptions) =>
  Test.createTestingModule({
    imports: [KafkaModule.registerAsync({ useFactory: () => options })],
  })
    .overrideProvider(KAFKA_PRODUCER)
    .useValue(producerStub())
    .compile();

describe('KafkaModule option validation', () => {
  it('rejects an empty namespace', async () => {
    await expect(
      compileWith({ clientOptions, namespace: '' }),
    ).rejects.toThrow(/"namespace" must not be an empty string/);
  });

  it('rejects an empty connector name', async () => {
    await expect(
      compileWith({ clientOptions, connectorName: '' }),
    ).rejects.toThrow(/"connectorName" must not be an empty string/);
  });

  it('rejects an empty namespace supplied asynchronously', async () => {
    await expect(
      compileAsyncWith({ clientOptions, namespace: '' }),
    ).rejects.toThrow(/"namespace" must not be an empty string/);
  });

  it('rejects an empty connector name supplied asynchronously', async () => {
    await expect(
      compileAsyncWith({ clientOptions, connectorName: '' }),
    ).rejects.toThrow(/"connectorName" must not be an empty string/);
  });

  it('rejects an unknown message format', async () => {
    await expect(
      compileWith({ clientOptions, messageFormat: 'Json' as MessageFormat }),
    ).rejects.toThrow(/"messageFormat" must be one of json, enveloped-json, avro/);
  });

  it('rejects an unknown message format supplied asynchronously', async () => {
    await expect(
      compileAsyncWith({ clientOptions, messageFormat: 'Json' as MessageFormat }),
    ).rejects.toThrow(/"messageFormat" must be one of json, enveloped-json, avro/);
  });

  it('accepts an omitted namespace and connector name', async () => {
    const moduleRef = await compileWith({ clientOptions });

    await expect(moduleRef.close()).resolves.toBeUndefined();
  });
});

describe('KafkaModule producer', () => {
  const producerConfigOf = async (imports: DynamicModule) => {
    const kafka = { producer: jest.fn().mockReturnValue(producerStub()) };

    const moduleRef = await Test.createTestingModule({ imports: [imports] })
      .overrideProvider(KafkaJS.Kafka)
      .useValue(kafka)
      .compile();
    await moduleRef.close();

    return kafka.producer.mock.calls[0][0];
  };

  it('creates the producer without auto topic creation by default', async () => {
    expect(
      await producerConfigOf(KafkaModule.register({ clientOptions })),
    ).toEqual({ kafkaJS: { allowAutoTopicCreation: false } });
  });

  it('creates the producer with auto topic creation when enabled', async () => {
    expect(
      await producerConfigOf(
        KafkaModule.register({
          clientOptions,
          producer: { allowAutoTopicCreation: true },
        }),
      ),
    ).toEqual({ kafkaJS: { allowAutoTopicCreation: true } });
  });

  it('creates the producer without auto topic creation by default when configured asynchronously', async () => {
    expect(
      await producerConfigOf(
        KafkaModule.registerAsync({ useFactory: () => ({ clientOptions }) }),
      ),
    ).toEqual({ kafkaJS: { allowAutoTopicCreation: false } });
  });

  it('creates the producer with auto topic creation when enabled asynchronously', async () => {
    expect(
      await producerConfigOf(
        KafkaModule.registerAsync({
          useFactory: () => ({
            clientOptions,
            producer: { allowAutoTopicCreation: true },
          }),
        }),
      ),
    ).toEqual({ kafkaJS: { allowAutoTopicCreation: true } });
  });

  it('creates the producer with the configured delivery settings', async () => {
    expect(
      await producerConfigOf(
        KafkaModule.register({
          clientOptions,
          producer: { idempotent: true, acks: -1, compression: 'gzip' },
        }),
      ),
    ).toEqual({
      kafkaJS: {
        allowAutoTopicCreation: false,
        idempotent: true,
        acks: -1,
        compression: 'gzip',
      },
    });
  });

  it('creates the producer with the configured delivery settings asynchronously', async () => {
    expect(
      await producerConfigOf(
        KafkaModule.registerAsync({
          useFactory: () => ({
            clientOptions,
            producer: { idempotent: true, acks: -1, compression: 'gzip' },
          }),
        }),
      ),
    ).toEqual({
      kafkaJS: {
        allowAutoTopicCreation: false,
        idempotent: true,
        acks: -1,
        compression: 'gzip',
      },
    });
  });

  it('rejects an unknown producer compression', async () => {
    await expect(
      producerConfigOf(
        KafkaModule.register({
          clientOptions,
          producer: { compression: 'brotli' as ProducerCompression },
        }),
      ),
    ).rejects.toThrow(
      'KafkaModule "producer.compression" must be one of none, gzip, snappy, lz4, zstd. Use one of those codecs or leave it unset for the client default.',
    );
  });

  it('fails module construction when an idempotent producer is not set to acks -1', async () => {
    await expect(
      producerConfigOf(
        KafkaModule.register({
          clientOptions,
          producer: { idempotent: true, acks: 1 },
        }),
      ),
    ).rejects.toThrow(
      'KafkaModule "producer.acks" must be -1 when "producer.idempotent" is true. Set acks to -1, leave it unset, or turn idempotence off.',
    );
  });
});

describe('KafkaModule schema registry', () => {
  beforeEach(() => {
    jest.mocked(SchemaRegistry).mockClear();
  });

  it('constructs the schema registry against the configured url', async () => {
    const moduleRef = await compileWith({
      clientOptions,
      schemaRegistry: { url: 'http://registry:8081' },
    });
    await moduleRef.close();

    expect(SchemaRegistry).toHaveBeenCalledWith({ host: 'http://registry:8081' });
  });

  it('does not construct a schema registry when none is configured', async () => {
    const moduleRef = await compileWith({ clientOptions });
    await moduleRef.close();

    expect(SchemaRegistry).not.toHaveBeenCalled();
  });

  it('constructs one schema registry for the producer and the consumer', async () => {
    const moduleRef = await compileWith({
      clientOptions,
      schemaRegistry: { url: 'http://registry:8081' },
    });
    await moduleRef.close();

    expect(SchemaRegistry).toHaveBeenCalledTimes(1);
  });

  it('constructs one schema registry when configured asynchronously', async () => {
    const moduleRef = await compileAsyncWith({
      clientOptions,
      schemaRegistry: { url: 'http://registry:8081' },
    });
    await moduleRef.close();

    expect(SchemaRegistry).toHaveBeenCalledTimes(1);
  });
});

describe('KafkaModule avro', () => {
  const encodedAvro = Buffer.from([0, 0, 0, 0, 7, 1]);

  const registryStub = () => ({
    getLatestSchemaId: jest.fn().mockResolvedValue(7),
    encode: jest.fn().mockResolvedValue(encodedAvro),
  });

  const useRegistry = (registry: ReturnType<typeof registryStub>) =>
    jest
      .mocked(SchemaRegistry)
      .mockImplementation(() => registry as unknown as SchemaRegistry);

  const avroOptions: KafkaModuleOptions = {
    clientOptions,
    messageFormat: MessageFormat.AVRO,
    schemaRegistry: { url: 'http://registry:8081' },
  };

  afterEach(() => {
    jest.mocked(SchemaRegistry).mockReset();
    jest.restoreAllMocks();
  });

  const produce = async (options: KafkaModuleOptions) => {
    const producer = producerStub();
    const moduleRef = await Test.createTestingModule({
      imports: [KafkaModule.registerAsync({ useFactory: () => options })],
    })
      .overrideProvider(KAFKA_PRODUCER)
      .useValue(producer)
      .compile();

    try {
      await moduleRef.get(ProducerProxy).send('orders.created', {
        key: null,
        value: { orderId: 'o-1' },
      });
    } finally {
      await moduleRef.close();
    }

    return producer.send.mock.calls[0][0].messages[0].value;
  };

  it('produces Avro through the configured schema registry', async () => {
    useRegistry(registryStub());

    expect(await produce(avroOptions)).toBe(encodedAvro);
  });

  it('rejects an Avro send when no schema registry is configured', async () => {
    await expect(
      produce({ clientOptions, messageFormat: MessageFormat.AVRO }),
    ).rejects.toThrow('Avro message format requires a Schema Registry.');
  });
});

describe('KafkaModule connections', () => {
  it('provides the Kafka connections for bootstrap cleanup', async () => {
    const moduleRef = await compileWith({ clientOptions });
    const asyncModuleRef = await compileAsyncWith({ clientOptions });

    expect(
      moduleRef.get<IReleaseConnections>(KAFKA_CONNECTIONS).releaseConnections,
    ).toBeInstanceOf(Function);
    expect(
      asyncModuleRef.get<IReleaseConnections>(KAFKA_CONNECTIONS).releaseConnections,
    ).toBeInstanceOf(Function);

    await moduleRef.close();
    await asyncModuleRef.close();
  });
});

describe('KafkaModule batch consumer', () => {
  it('resolves the batch consumer to the consumer proxy instance', async () => {
    const moduleRef = await compileWith({ clientOptions });

    expect(moduleRef.get(BATCH_CONSUMER)).toBe(moduleRef.get(ConsumerProxy));

    await moduleRef.close();
  });

  it('resolves the batch consumer to the consumer proxy instance when registered asynchronously', async () => {
    const moduleRef = await compileAsyncWith({ clientOptions });

    expect(moduleRef.get(BATCH_CONSUMER)).toBe(moduleRef.get(ConsumerProxy));

    await moduleRef.close();
  });
});

describe('KafkaModule shared group consumer', () => {
  it('resolves the shared group consumer to the consumer proxy instance', async () => {
    const moduleRef = await compileWith({ clientOptions });

    expect(moduleRef.get(SHARED_GROUP_CONSUMER)).toBe(moduleRef.get(ConsumerProxy));

    await moduleRef.close();
  });

  it('resolves the shared group consumer to the consumer proxy instance when registered asynchronously', async () => {
    const moduleRef = await compileAsyncWith({ clientOptions });

    expect(moduleRef.get(SHARED_GROUP_CONSUMER)).toBe(moduleRef.get(ConsumerProxy));

    await moduleRef.close();
  });
});

describe('KafkaModule message format', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  const producedValue = async (options: KafkaModuleOptions) => {
    const producer = producerStub();
    const moduleRef = await Test.createTestingModule({
      imports: [KafkaModule.registerAsync({ useFactory: () => options })],
    })
      .overrideProvider(KAFKA_PRODUCER)
      .useValue(producer)
      .compile();

    await moduleRef.get(ProducerProxy).send('orders.created', {
      key: null,
      value: { orderId: 'o-1' },
    });
    await moduleRef.close();

    return producer.send.mock.calls[0][0].messages[0].value;
  };

  const consumedFormat = async (options: KafkaModuleOptions) => {
    const stop = new Error('stop before connecting');
    const create = jest
      .spyOn(KafkaMessageParseStrategyFactory.prototype, 'create')
      .mockImplementation(() => {
        throw stop;
      });
    const moduleRef = await compileWith(options);

    await expect(
      moduleRef.get(ConsumerProxy).subscribe(
        { topicPatterns: ['orders.created'], errorHandling: { type: 'ignore' } },
        jest.fn(),
        'orders-service',
      ),
    ).rejects.toBe(stop);
    await moduleRef.close();

    return create.mock.calls[0][0];
  };

  it('produces without an envelope by default', async () => {
    expect(await producedValue({ clientOptions })).toBe('{"orderId":"o-1"}');
  });

  it('produces with the module message format', async () => {
    expect(
      await producedValue({ clientOptions, messageFormat: MessageFormat.ENVELOPED_JSON }),
    ).toBe('{"payload":{"orderId":"o-1"}}');
  });

  it('consumes as JSON by default', async () => {
    expect(await consumedFormat({ clientOptions })).toBe(MessageFormat.JSON);
  });

  it('consumes with the module message format', async () => {
    expect(
      await consumedFormat({ clientOptions, messageFormat: MessageFormat.ENVELOPED_JSON }),
    ).toBe(MessageFormat.ENVELOPED_JSON);
  });
});
