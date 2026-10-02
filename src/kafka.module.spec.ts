import { Test } from '@nestjs/testing';
import { KafkaJS } from '@confluentinc/kafka-javascript';
import { SchemaRegistry } from '@kafkajs/confluent-schema-registry';
import { KafkaModule } from './kafka.module.js';
import { KafkaModuleOptions } from './types/kafka-module-options.type.js';
import { IReleaseConnections } from './interfaces/release-connections.interface.js';
import { KAFKA_PRODUCER, KAFKA_CONNECTIONS } from './tokens.js';
import { ConsumerProxy } from './base/consumer-proxy.js';
import { ProducerProxy } from './base/producer-proxy.js';
import { MessageFormat } from './types/message-format.type.js';
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

  it('accepts an omitted namespace and connector name', async () => {
    const moduleRef = await compileWith({ clientOptions });

    await expect(moduleRef.close()).resolves.toBeUndefined();
  });
});

describe('KafkaModule producer', () => {
  it('creates the producer with auto topic creation and the client default partitioner', async () => {
    const kafka = { producer: jest.fn().mockReturnValue(producerStub()) };

    const moduleRef = await Test.createTestingModule({
      imports: [KafkaModule.register({ clientOptions })],
    })
      .overrideProvider(KafkaJS.Kafka)
      .useValue(kafka)
      .compile();
    await moduleRef.close();

    expect(kafka.producer).toHaveBeenCalledWith({
      kafkaJS: { allowAutoTopicCreation: true },
    });
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
