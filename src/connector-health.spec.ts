import { DynamicModule, Inject, Injectable, Module } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { KafkaJS } from '@confluentinc/kafka-javascript';
import { ConnectorHealth, getHealthToken, KafkaModule, KafkaModuleAsyncOptions, KafkaModuleOptionsFactory, Message } from './index.js';
import { KafkaProducer } from './implementations/kafka/kafka-producer.js';
import * as publicApi from './index.js';

const clientOptions = { kafkaJS: { brokers: ['localhost:9092'] } };

@Injectable()
class HealthReader {
  constructor(
    @Inject(getHealthToken('analytics')) readonly analytics: ConnectorHealth,
    @Inject(getHealthToken('billing')) readonly billing: ConnectorHealth,
  ) {}
}

class OptionsFactory implements KafkaModuleOptionsFactory {
  createKafkaOptions() { return { clientOptions }; }
}

@Module({ providers: [OptionsFactory], exports: [OptionsFactory] })
class OptionsModule {}

const variants: Array<[string, KafkaModuleAsyncOptions]> = [
  ['useFactory', { useFactory: async () => ({ clientOptions }) }],
  ['useClass', { useClass: OptionsFactory }],
  ['useExisting', { imports: [OptionsModule], useExisting: OptionsFactory }],
];

describe('connector health injection', () => {
  let moduleRef: TestingModule | undefined;

  beforeEach(() => {
    jest.spyOn(KafkaJS.Kafka.prototype, 'producer').mockImplementation(() => ({
      connect: jest.fn().mockResolvedValue(undefined),
      disconnect: jest.fn().mockResolvedValue(undefined),
    }) as unknown as KafkaJS.Producer);
  });

  afterEach(async () => {
    await moduleRef?.close();
    moduleRef = undefined;
    jest.restoreAllMocks();
  });

  const compile = async (imports: DynamicModule[]) => {
    moduleRef = await Test.createTestingModule({ imports, providers: [HealthReader] }, {
      moduleIdGeneratorAlgorithm: 'deep-hash',
    }).compile();
    return moduleRef;
  };

  it('supports plain class injection for one unnamed connector', async () => {
    @Injectable()
    class Host { constructor(readonly health: ConnectorHealth) {} }
    moduleRef = await Test.createTestingModule({ imports: [KafkaModule.register({ clientOptions })], providers: [Host] }).compile();

    expect(moduleRef.get(Host).health.snapshot()).toEqual({ producerConnected: true, groups: [] });
  });

  it('exposes only a frozen read method to the host', async () => {
    moduleRef = await Test.createTestingModule({ imports: [KafkaModule.register({ clientOptions })] }).compile();
    const health = moduleRef.get(ConnectorHealth);

    expect(Object.keys(health)).toEqual(['snapshot']);
    expect(Object.isFrozen(health)).toBe(true);
  });

  it('keeps named synchronous connectors isolated through shutdown', async () => {
    const imports = ['analytics', 'billing'].map((connectorName) => KafkaModule.register({ clientOptions, connectorName }));
    const context = await compile(imports);
    const { analytics, billing } = context.get(HealthReader);
    const analyticsModule = context.select(imports[0]);
    const { ProducerProxy } = publicApi;
    await (analyticsModule.get(ProducerProxy, { strict: true }) as KafkaProducer).disconnect();

    expect(analytics.snapshot().producerConnected).toBe(false);
    expect(billing.snapshot().producerConnected).toBe(true);
  });

  it.each(variants)('uses distinct static async identities with %s', async (_name, options) => {
    const imports = ['analytics', 'billing'].map((connectorName) => KafkaModule.registerAsync({ ...options, connectorName }));
    const context = await compile(imports);
    const { analytics, billing } = context.get(HealthReader);

    expect(analytics).toBe(context.select(imports[0]).get(ConnectorHealth, { strict: true }));
    expect(billing).toBe(context.select(imports[1]).get(ConnectorHealth, { strict: true }));
    expect(analytics).not.toBe(billing);
  });

  it('does not create a named alias from an async factory-only name', async () => {
    moduleRef = await Test.createTestingModule({ imports: [KafkaModule.registerAsync({ useFactory: () => ({ clientOptions, connectorName: 'analytics' }) })] }).compile();

    expect(() => moduleRef!.get(getHealthToken('analytics'))).toThrow();
  });

  it('exposes an unjoined group after failed bootstrap cleanup', async () => {
    @Injectable()
    class Handler {
      @Message(['orders'], { groupId: 'g', consumer: { fromBeginning: true }, errorHandling: { type: 'ignore' } })
      async handle(): Promise<void> {}
    }
    jest.spyOn(KafkaJS.Kafka.prototype, 'admin').mockReturnValue({
      connect: jest.fn().mockResolvedValue(undefined),
      disconnect: jest.fn().mockResolvedValue(undefined),
      listTopics: jest.fn().mockResolvedValue(['orders']),
    } as unknown as KafkaJS.Admin);
    const disconnect = jest.fn().mockResolvedValue(undefined);
    jest.spyOn(KafkaJS.Kafka.prototype, 'consumer').mockReturnValue({
      connect: jest.fn().mockRejectedValue(new Error('connect failed')),
      disconnect,
    } as unknown as KafkaJS.Consumer);
    moduleRef = await Test.createTestingModule({ imports: [KafkaModule.register({ clientOptions })], providers: [Handler] }).compile();
    const health = moduleRef.get(ConnectorHealth);
    await expect(moduleRef.init()).rejects.toThrow('connect failed');
    moduleRef = undefined;

    expect(health.snapshot()).toEqual({ producerConnected: false, groups: [{ groupId: 'g', joined: false, assignment: [], lastWorkerError: null }] });
    expect(disconnect).toHaveBeenCalledTimes(1);
  });

  it('does not export mutable health implementation classes', () => {
    expect(publicApi).not.toHaveProperty('ConnectorHealthState');
    expect(publicApi).not.toHaveProperty('GroupObservation');
  });
});
