import type { SchemaRegistry } from '@kafkajs/confluent-schema-registry';
import { MessageFormat } from '../../../types/message-format.type.js';
import { KafkaMessageSerializeStrategyFactory } from './kafka-message-serialize-strategy.factory.js';
import { KafkaMessageJsonSerializeStrategy } from './kafka-message-json-serialize.strategy.js';
import { KafkaMessageEnvelopedJsonSerializeStrategy } from './kafka-message-enveloped-json-serialize.strategy.js';
import { KafkaMessageAvroSerializeStrategy } from './kafka-message-avro-serialize.strategy.js';

describe('KafkaMessageSerializeStrategyFactory', () => {
  const target = { topic: 'orders.created' };
  const factory = new KafkaMessageSerializeStrategyFactory();

  it('creates a JSON strategy for the JSON format', () => {
    expect(factory.create(MessageFormat.JSON, target)).toBeInstanceOf(KafkaMessageJsonSerializeStrategy);
  });

  it('creates an enveloped JSON strategy for the enveloped JSON format', () => {
    expect(factory.create(MessageFormat.ENVELOPED_JSON, target)).toBeInstanceOf(
      KafkaMessageEnvelopedJsonSerializeStrategy,
    );
  });

  it('creates an Avro strategy for the Avro format when a schema registry is configured', () => {
    const registry = { getLatestSchemaId: jest.fn(), encode: jest.fn() } as unknown as SchemaRegistry;

    expect(new KafkaMessageSerializeStrategyFactory(registry).create(MessageFormat.AVRO, target)).toBeInstanceOf(
      KafkaMessageAvroSerializeStrategy,
    );
  });

  it('rejects the Avro format without a schema registry, saying how to configure one', () => {
    expect(() => factory.create(MessageFormat.AVRO, target)).toThrow(
      'Avro message format requires a Schema Registry. ' +
      'Provide "schemaRegistry" options in KafkaModule configuration ' +
      'and install @kafkajs/confluent-schema-registry.',
    );
  });

  it('rejects an unknown format', () => {
    expect(() => factory.create('protobuf' as MessageFormat, target)).toThrow(
      'Message serialize strategy not found for type: protobuf',
    );
  });
});

describe('Avro latest schema caching', () => {
  const target = { topic: 'orders.created' };
  let registry: SchemaRegistry;
  let factory: KafkaMessageSerializeStrategyFactory;
  const send = (subject?: string) =>
    factory.create(MessageFormat.AVRO, { ...target, subject }).serialize({ orderId: 'o-1' });

  beforeEach(() => {
    jest.useFakeTimers();
    registry = {
      getLatestSchemaId: jest.fn().mockResolvedValue(11),
      encode: jest.fn().mockResolvedValue(Buffer.from([11])),
    } as unknown as SchemaRegistry;
    factory = new KafkaMessageSerializeStrategyFactory(registry);
  });

  afterEach(() => jest.useRealTimers());

  it('reuses a subject lookup across newly created serializers', async () => {
    await send();
    await send();

    expect(registry.getLatestSchemaId).toHaveBeenCalledTimes(1);
  });

  it('refreshes the schema at the default 60000 ms boundary', async () => {
    await send();
    jest.advanceTimersByTime(59999);
    await send();
    (registry.getLatestSchemaId as jest.Mock).mockResolvedValue(12);
    jest.advanceTimersByTime(1);
    await send();

    expect(registry.encode).toHaveBeenLastCalledWith(12, { orderId: 'o-1' });
  });

  it('honors a custom TTL in milliseconds', async () => {
    factory = new KafkaMessageSerializeStrategyFactory(registry, { latestSchemaTtl: 25 });
    await send();
    jest.advanceTimersByTime(24);
    await send();
    jest.advanceTimersByTime(1);
    await send();

    expect(registry.getLatestSchemaId).toHaveBeenCalledTimes(2);
  });

  it('disables caching with a zero TTL', async () => {
    factory = new KafkaMessageSerializeStrategyFactory(registry, { latestSchemaTtl: 0 });
    await send();
    await send();

    expect(registry.getLatestSchemaId).toHaveBeenCalledTimes(2);
  });

  it('coalesces concurrent lookups for the same subject', async () => {
    await Promise.all([send(), send()]);

    expect(registry.getLatestSchemaId).toHaveBeenCalledTimes(1);
  });

  it('uses an unexpired cached id while the registry is unavailable', async () => {
    await send();
    (registry.getLatestSchemaId as jest.Mock).mockRejectedValue(new Error('registry unavailable'));
    await send();

    expect(registry.getLatestSchemaId).toHaveBeenCalledTimes(1);
  });

  it('retries after a failed refresh instead of serving an expired id', async () => {
    await send();
    jest.advanceTimersByTime(60000);
    (registry.getLatestSchemaId as jest.Mock).mockRejectedValueOnce(new Error('registry unavailable'));
    await expect(send()).rejects.toThrow('registry unavailable');
    (registry.getLatestSchemaId as jest.Mock).mockResolvedValue(12);
    await send();

    expect(registry.encode).toHaveBeenLastCalledWith(12, { orderId: 'o-1' });
  });

  it('does not extend expiry when a cached id is reused', async () => {
    await send();
    jest.advanceTimersByTime(59999);
    await send();

    expect(registry.getLatestSchemaId).toHaveBeenCalledTimes(1);
  });

  it('does not extend expiry by the duration of a slow lookup', async () => {
    let resolveLookup!: (id: number) => void;
    (registry.getLatestSchemaId as jest.Mock).mockImplementationOnce(() =>
      new Promise<number>((resolve) => { resolveLookup = resolve; }));
    const firstSend = send();
    jest.advanceTimersByTime(60000);
    resolveLookup(11);
    await firstSend;
    await send();

    expect(registry.getLatestSchemaId).toHaveBeenCalledTimes(2);
  });

  it('clears a failed concurrent lookup before retrying', async () => {
    (registry.getLatestSchemaId as jest.Mock).mockRejectedValueOnce(new Error('registry unavailable'));
    const results = await Promise.allSettled([send(), send()]);
    expect(results.map((result) => result.status)).toEqual(['rejected', 'rejected']);

    await send();

    expect(registry.getLatestSchemaId).toHaveBeenCalledTimes(2);
  });

  it('keeps subjects separate', async () => {
    await send('orders-v1');
    await send('orders-v2');

    expect(registry.getLatestSchemaId).toHaveBeenNthCalledWith(2, 'orders-v2');
  });

  it('keeps registry clients separate', async () => {
    await send();
    const otherRegistry = {
      getLatestSchemaId: jest.fn().mockResolvedValue(42),
      encode: jest.fn(),
    } as unknown as SchemaRegistry;

    await new KafkaMessageSerializeStrategyFactory(otherRegistry)
      .create(MessageFormat.AVRO, target).serialize({ orderId: 'o-1' });

    expect(otherRegistry.encode).toHaveBeenCalledWith(42, { orderId: 'o-1' });
  });

  it('keeps connector factories separate even with the same registry client', async () => {
    await send();
    await new KafkaMessageSerializeStrategyFactory(registry)
      .create(MessageFormat.AVRO, target).serialize({ orderId: 'o-1' });

    expect(registry.getLatestSchemaId).toHaveBeenCalledTimes(2);
  });

  it('retries a failed lookup on the next send', async () => {
    (registry.getLatestSchemaId as jest.Mock).mockRejectedValueOnce(new Error('registry unavailable'));
    await expect(send()).rejects.toThrow('registry unavailable');
    await send();

    expect(registry.encode).toHaveBeenCalledWith(11, { orderId: 'o-1' });
  });

  it('bypasses the latest lookup for an explicit schema id', async () => {
    await send();
    await factory.create(MessageFormat.AVRO, { ...target, schemaId: 42 }).serialize({ orderId: 'o-1' });

    expect(registry.encode).toHaveBeenLastCalledWith(42, { orderId: 'o-1' });
  });
});
