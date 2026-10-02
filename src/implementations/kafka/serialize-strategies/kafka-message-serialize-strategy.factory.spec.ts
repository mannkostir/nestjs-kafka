import { MessageFormat } from '../../../types/message-format.type.js';
import { KafkaMessageSerializeStrategyFactory } from './kafka-message-serialize-strategy.factory.js';
import { KafkaMessageJsonSerializeStrategy } from './kafka-message-json-serialize.strategy.js';
import { KafkaMessageEnvelopedJsonSerializeStrategy } from './kafka-message-enveloped-json-serialize.strategy.js';

describe('KafkaMessageSerializeStrategyFactory', () => {
  const factory = new KafkaMessageSerializeStrategyFactory();

  it('creates a JSON strategy for the JSON format', () => {
    expect(factory.create(MessageFormat.JSON)).toBeInstanceOf(KafkaMessageJsonSerializeStrategy);
  });

  it('creates an enveloped JSON strategy for the enveloped JSON format', () => {
    expect(factory.create(MessageFormat.ENVELOPED_JSON)).toBeInstanceOf(
      KafkaMessageEnvelopedJsonSerializeStrategy,
    );
  });

  it('rejects the Avro format naming the supported formats', () => {
    expect(() => factory.create(MessageFormat.AVRO)).toThrow(
      'Producing Avro messages is not supported yet. ' +
      'Send with messageFormat MessageFormat.JSON or MessageFormat.ENVELOPED_JSON.',
    );
  });

  it('rejects an unknown format', () => {
    expect(() => factory.create('protobuf' as MessageFormat)).toThrow(
      'Message serialize strategy not found for type: protobuf',
    );
  });
});
