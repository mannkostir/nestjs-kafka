import { DynamicModule, Injectable, Module } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { KafkaJS } from '@confluentinc/kafka-javascript';
import { getProducerToken, InjectProducer, KafkaModule, KafkaModuleAsyncOptions, KafkaModuleOptions, KafkaModuleOptionsFactory, Message, ProducerProxy } from './index.js';
import { CONNECTOR_NAME } from './tokens.js';
import { KafkaConsumer } from './implementations/kafka/kafka-consumer.js';

const clientOptions = { kafkaJS: { brokers: ['localhost:9092'] } };
const producerStub = () => ({
  connect: jest.fn().mockResolvedValue(undefined),
  disconnect: jest.fn().mockResolvedValue(undefined),
  send: jest.fn().mockResolvedValue([]),
});

@Injectable()
class Publisher {
  constructor(
    @InjectProducer('analytics') readonly analytics: ProducerProxy,
    @InjectProducer('billing') readonly billing: ProducerProxy,
  ) {}
}

class OptionsFactory implements KafkaModuleOptionsFactory {
  createKafkaOptions(): Promise<KafkaModuleOptions> {
    return Promise.resolve({ clientOptions });
  }
}

@Module({ providers: [OptionsFactory], exports: [OptionsFactory] })
class OptionsModule {}

const variants: Array<[string, KafkaModuleAsyncOptions]> = [
  ['useFactory', { useFactory: async () => ({ clientOptions }) }],
  ['useClass', { useClass: OptionsFactory }],
  ['useExisting', { imports: [OptionsModule], useExisting: OptionsFactory }],
];

describe('named producer injection', () => {
  let producers: Array<ReturnType<typeof producerStub>>;
  let moduleRef: TestingModule | undefined;

  beforeEach(() => {
    producers = [];
    jest.spyOn(KafkaJS.Kafka.prototype, 'producer').mockImplementation(() => {
      const producer = producerStub();
      producers.push(producer);
      return producer as unknown as KafkaJS.Producer;
    });
  });

  afterEach(async () => {
    await moduleRef?.close();
    moduleRef = undefined;
    jest.restoreAllMocks();
  });

  const compile = async (imports: DynamicModule[]) => {
    moduleRef = await Test.createTestingModule({ imports, providers: [Publisher] }, {
      moduleIdGeneratorAlgorithm: 'deep-hash',
    }).compile();
    return moduleRef;
  };

  const assertRouting = async (context: TestingModule, namespaced = false) => {
    const publisher = context.get(Publisher);
    await publisher.analytics.send('clicks', { key: null, value: 1 });
    await publisher.billing.send('invoices', { key: null, value: 2 });
    expect(producers.map((producer) => producer.send.mock.calls.map(([request]) => request.topic)).sort())
      .toEqual(namespaced ? [['analytics.clicks'], ['billing.invoices']] : [['clicks'], ['invoices']]);
  };

  it('selects each connector producer through its exported decorator', async () => {
    const context = await compile(['analytics', 'billing'].map((connectorName) =>
      KafkaModule.register({ clientOptions, connectorName, namespace: connectorName })));

    await assertRouting(context, true);
  });

  it('resolves each async alias to its own module producer', async () => {
    const imports = ['analytics', 'billing'].map((connectorName) =>
      KafkaModule.registerAsync({ connectorName, useFactory: () => ({ clientOptions }) }));
    const context = await compile(imports);

    expect([context.get(Publisher).analytics, context.get(Publisher).billing]).toEqual(
      imports.map((registration) => context.select(registration).get(ProducerProxy, { strict: true })),
    );
  });

  it('preserves factory dependency injection when applying the top-level name', async () => {
    @Module({ providers: [{ provide: 'BROKERS', useValue: ['injected:9092'] }], exports: ['BROKERS'] })
    class ConfigModule {}
    const factory = jest.fn((brokers: string[]) => ({ clientOptions: { kafkaJS: { brokers } } }));
    moduleRef = await Test.createTestingModule({
      imports: [KafkaModule.registerAsync({
        connectorName: 'analytics', imports: [ConfigModule], inject: ['BROKERS'], useFactory: factory,
      })],
    }).compile();

    expect(factory).toHaveBeenCalledWith(['injected:9092']);
  });

  it('applies the top-level name without mutating frozen factory options', async () => {
    const options = Object.freeze({ clientOptions });
    moduleRef = await Test.createTestingModule({
      imports: [KafkaModule.registerAsync({ connectorName: 'analytics', useFactory: () => options })],
    }).compile();

    expect(options).toEqual({ clientOptions });
  });

  it('exports token aliases for distinct producer instances', async () => {
    const context = await compile(['analytics', 'billing'].map((connectorName) =>
      KafkaModule.register({ clientOptions, connectorName, namespace: connectorName })));

    expect(context.get(getProducerToken('analytics'))).not.toBe(context.get(getProducerToken('billing')));
  });

  it('disconnects each aliased producer exactly once', async () => {
    await compile(['analytics', 'billing'].map((connectorName) =>
      KafkaModule.register({ clientOptions, connectorName, namespace: connectorName })));

    await moduleRef!.close();
    moduleRef = undefined;

    expect(producers.map((producer) => producer.disconnect.mock.calls.length)).toEqual([1, 1]);
  });

  it.each(variants)('routes named producers with %s and identical factory metadata', async (_name, options) => {
    const context = await compile(['analytics', 'billing'].map((connectorName) =>
      KafkaModule.registerAsync({ ...options, connectorName })));

    await assertRouting(context);
  });

  it.each(variants)('applies the top-level name to resolved options with %s', async (_name, options) => {
    moduleRef = await Test.createTestingModule({
      imports: [KafkaModule.registerAsync({ ...options, connectorName: 'analytics' })],
    }).compile();

    expect(moduleRef.get(CONNECTOR_NAME)).toBe('analytics');
  });

  it('keeps the named alias identical to plain producer injection', async () => {
    moduleRef = await Test.createTestingModule({
      imports: [KafkaModule.register({ clientOptions, connectorName: 'analytics' })],
    }).compile();

    expect(moduleRef.get(getProducerToken('analytics'))).toBe(moduleRef.get(ProducerProxy));
  });

  it('keeps factory-only names valid for plain injection', async () => {
    moduleRef = await Test.createTestingModule({
      imports: [KafkaModule.registerAsync({ useFactory: () => ({ clientOptions, connectorName: 'analytics' }) })],
    }).compile();

    expect(moduleRef.get(ProducerProxy)).toBeInstanceOf(ProducerProxy);
  });

  it('does not export a named alias for a factory-only name', async () => {
    moduleRef = await Test.createTestingModule({
      imports: [KafkaModule.registerAsync({ useFactory: () => ({ clientOptions, connectorName: 'analytics' }) })],
    }).compile();

    expect(() => moduleRef!.get(getProducerToken('analytics'))).toThrow();
  });

  it('accepts an explicitly matching factory name without mutating options', async () => {
    const options = Object.freeze({ clientOptions, connectorName: 'analytics' });
    moduleRef = await Test.createTestingModule({
      imports: [KafkaModule.registerAsync({ connectorName: 'analytics', useFactory: () => options })],
    }).compile();

    expect(moduleRef.get(CONNECTOR_NAME)).toBe('analytics');
  });

  const mismatchVariants: Array<[string, KafkaModuleAsyncOptions]> = (() => {
    class MismatchFactory implements KafkaModuleOptionsFactory {
      createKafkaOptions(): KafkaModuleOptions {
        return { clientOptions, connectorName: 'billing' };
      }
    }
    @Module({ providers: [MismatchFactory], exports: [MismatchFactory] })
    class MismatchModule {}
    return [
      ['useFactory', { useFactory: async () => ({ clientOptions, connectorName: 'billing' }) }],
      ['useClass', { useClass: MismatchFactory }],
      ['useExisting', { imports: [MismatchModule], useExisting: MismatchFactory }],
    ];
  })();

  it.each(mismatchVariants)('rejects a mismatching returned name before opening producers with %s', async (_name, options) => {
    await expect(Test.createTestingModule({
      imports: [KafkaModule.registerAsync({ ...options, connectorName: 'analytics' })],
    }).compile()).rejects.toThrow(/connectorName.*analytics.*billing/);
    expect(producers).toHaveLength(0);
  });

  it.each(['', 42, null])('rejects invalid top-level connector name %p', async (connectorName) => {
    await expect(Promise.resolve().then(() => Test.createTestingModule({
      imports: [KafkaModule.registerAsync({ connectorName: connectorName as string, useFactory: () => ({ clientOptions }) })],
    }).compile())).rejects.toThrow(/connectorName/);
  });

  it('uses the inherited async name for handler discovery', async () => {
    @Injectable()
    class Handler {
      @Message(['clicks'], { connectorName: 'analytics', groupId: 'clicks', errorHandling: { type: 'ignore' } })
      async handle(): Promise<void> {}
    }
    const subscribe = jest.spyOn(KafkaConsumer.prototype, 'subscribe').mockResolvedValue(undefined);
    moduleRef = await Test.createTestingModule({
      imports: [KafkaModule.registerAsync({ connectorName: 'analytics', useFactory: () => ({ clientOptions }) })],
      providers: [Handler],
    }).compile();

    await moduleRef.init();

    expect(subscribe).toHaveBeenCalledTimes(1);
  });
});
