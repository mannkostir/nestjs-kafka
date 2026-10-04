import type { SchemaRegistry } from '@kafkajs/confluent-schema-registry';
import { MessageFormat } from '../../../types/message-format.type.js';
import { KafkaMessageSerializeStrategy } from './kafka-message-serialize.strategy.js';
import { KafkaMessageJsonSerializeStrategy } from './kafka-message-json-serialize.strategy.js';
import { KafkaMessageEnvelopedJsonSerializeStrategy } from './kafka-message-enveloped-json-serialize.strategy.js';
import { KafkaMessageAvroSerializeStrategy } from './kafka-message-avro-serialize.strategy.js';
import { SerializeTarget } from './serialize-target.js';

export class KafkaMessageSerializeStrategyFactory {
  constructor(private readonly schemaRegistry?: SchemaRegistry) {}

  public create(format: MessageFormat, target: SerializeTarget): KafkaMessageSerializeStrategy {
    switch (format) {
      case MessageFormat.JSON:
        return new KafkaMessageJsonSerializeStrategy();
      case MessageFormat.ENVELOPED_JSON:
        return new KafkaMessageEnvelopedJsonSerializeStrategy();
      case MessageFormat.AVRO:
        return this.createAvro(target);
      default:
        throw new Error(`Message serialize strategy not found for type: ${format}`);
    }
  }

  private createAvro(target: SerializeTarget): KafkaMessageAvroSerializeStrategy {
    if (!this.schemaRegistry) {
      throw new Error(
        'Avro message format requires a Schema Registry. ' +
        'Provide "schemaRegistry" options in KafkaModule configuration ' +
        'and install @kafkajs/confluent-schema-registry.',
      );
    }

    return new KafkaMessageAvroSerializeStrategy(this.schemaRegistry, target);
  }
}
