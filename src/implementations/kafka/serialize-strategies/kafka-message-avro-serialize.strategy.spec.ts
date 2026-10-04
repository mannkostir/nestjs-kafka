import type { SchemaRegistry } from '@kafkajs/confluent-schema-registry';
import { KafkaMessageAvroSerializeStrategy } from './kafka-message-avro-serialize.strategy.js';

describe('KafkaMessageAvroSerializeStrategy', () => {
  const encoded = Buffer.from([0, 0, 0, 0, 7, 2]);
  const registry = {
    getLatestSchemaId: jest.fn(),
    encode: jest.fn(),
  } as unknown as SchemaRegistry;

  beforeEach(() => {
    (registry.getLatestSchemaId as jest.Mock).mockReset();
    (registry.getLatestSchemaId as jest.Mock).mockResolvedValue(11);
    (registry.encode as jest.Mock).mockReset();
    (registry.encode as jest.Mock).mockResolvedValue(encoded);
  });

  it('encodes with the explicit schema id without looking up a subject', async () => {
    await new KafkaMessageAvroSerializeStrategy(registry, { topic: 'orders.created', schemaId: 7 })
      .serialize({ orderId: 'o-1' });

    expect(registry.getLatestSchemaId).not.toHaveBeenCalled();
    expect(registry.encode).toHaveBeenCalledWith(7, { orderId: 'o-1' });
  });

  it('encodes with the latest schema of the given subject', async () => {
    await new KafkaMessageAvroSerializeStrategy(registry, { topic: 'orders.created', subject: 'orders' })
      .serialize({ orderId: 'o-1' });

    expect(registry.getLatestSchemaId).toHaveBeenCalledWith('orders');
    expect(registry.encode).toHaveBeenCalledWith(11, { orderId: 'o-1' });
  });

  it('defaults the subject to the topic value subject', async () => {
    await new KafkaMessageAvroSerializeStrategy(registry, { topic: 'acme.orders.created' })
      .serialize({ orderId: 'o-1' });

    expect(registry.getLatestSchemaId).toHaveBeenCalledWith('acme.orders.created-value');
  });

  it('passes the raw value to the registry and returns its encoded buffer', async () => {
    const value = { orderId: 'o-1' };

    const result = await new KafkaMessageAvroSerializeStrategy(registry, { topic: 'orders.created', schemaId: 7 })
      .serialize(value);

    expect(registry.encode).toHaveBeenCalledWith(7, value);
    expect(result).toBe(encoded);
  });

  it('writes a null value as a record without a value', async () => {
    expect(
      await new KafkaMessageAvroSerializeStrategy(registry, { topic: 'orders.created' }).serialize(null),
    ).toBeNull();
  });

  it('does not touch the registry for a null value', async () => {
    await new KafkaMessageAvroSerializeStrategy(registry, { topic: 'orders.created' }).serialize(null);

    expect(registry.getLatestSchemaId).not.toHaveBeenCalled();
    expect(registry.encode).not.toHaveBeenCalled();
  });

  it('rejects a schema id together with a subject', () => {
    expect(
      () => new KafkaMessageAvroSerializeStrategy(registry, { topic: 'orders.created', schemaId: 7, subject: 'orders' }),
    ).toThrow(
      'Avro send options "schemaId" and "subject" are mutually exclusive. ' +
      'Pass "schemaId" to encode with that exact schema, or "subject" to use its latest version.',
    );
  });

  it('rejects a schema id that is not a positive integer', () => {
    expect(
      () => new KafkaMessageAvroSerializeStrategy(registry, { topic: 'orders.created', schemaId: 1.5 }),
    ).toThrow('Avro send option "schemaId" must be a positive integer registry id. Got 1.5.');
  });

  it('rejects a zero schema id', () => {
    expect(
      () => new KafkaMessageAvroSerializeStrategy(registry, { topic: 'orders.created', schemaId: 0 }),
    ).toThrow('Avro send option "schemaId" must be a positive integer registry id. Got 0.');
  });

  it('rejects an empty subject', () => {
    expect(
      () => new KafkaMessageAvroSerializeStrategy(registry, { topic: 'orders.created', subject: '' }),
    ).toThrow(
      'Avro send option "subject" must not be an empty string. ' +
      'Pass a subject name, or omit it to use "orders.created-value".',
    );
  });
});
