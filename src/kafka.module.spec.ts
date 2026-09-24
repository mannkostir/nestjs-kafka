import { Test } from '@nestjs/testing';
import { KafkaModule } from './kafka.module';
import { KafkaModuleOptions } from './types/kafka-module-options.type';
import { KAFKA_PRODUCER } from './tokens';

const clientOptions = { brokers: ['localhost:9092'] };

const producerStub = () => ({
  connect: jest.fn().mockResolvedValue(undefined),
  disconnect: jest.fn().mockResolvedValue(undefined),
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
