import type { SchemaRegistry } from '@kafkajs/confluent-schema-registry';
import { MessageFormat } from '../../../types/message-format.type.js';
import { KafkaMessageParseStrategyFactory } from './kafka-message-parse-strategy.factory.js';
import { KafkaMessageJsonStrategy } from './kafka-message-json.strategy.js';
import { KafkaMessageAvroStrategy } from './kafka-message-avro.strategy.js';

const registryStub = () => ({ decode: jest.fn() }) as unknown as SchemaRegistry;

describe('KafkaMessageParseStrategyFactory', () => {
  it('creates a JSON strategy for the JSON format', () => {
    const factory = new KafkaMessageParseStrategyFactory();

    const strategy = factory.create(MessageFormat.JSON);

    expect(strategy).toBeInstanceOf(KafkaMessageJsonStrategy);
  });

  it('creates an Avro strategy for the Avro format when a registry is configured', () => {
    const factory = new KafkaMessageParseStrategyFactory(registryStub());

    const strategy = factory.create(MessageFormat.AVRO);

    expect(strategy).toBeInstanceOf(KafkaMessageAvroStrategy);
  });

  it('rejects the Avro format without a schema registry', () => {
    const factory = new KafkaMessageParseStrategyFactory();

    expect(() => factory.create(MessageFormat.AVRO)).toThrow(
      'Avro message format requires a Schema Registry. ' +
      'Provide "schemaRegistry" options in KafkaModule configuration ' +
      'and install @kafkajs/confluent-schema-registry.',
    );
  });

  it('rejects an unknown format', () => {
    const factory = new KafkaMessageParseStrategyFactory();

    expect(() => factory.create('protobuf' as MessageFormat)).toThrow(
      'Message parse strategy not found for type: protobuf',
    );
  });
});
