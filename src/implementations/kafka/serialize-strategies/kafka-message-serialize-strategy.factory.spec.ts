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
