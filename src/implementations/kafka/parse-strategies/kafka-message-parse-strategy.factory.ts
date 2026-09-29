import type { SchemaRegistry } from '@kafkajs/confluent-schema-registry';
import { MessageFormat } from '../../../types/message-format.type.js';
import { KafkaMessageParseStrategy } from './kafka-message-parse.strategy.js';
import { KafkaMessageJsonStrategy } from './kafka-message-json.strategy.js';
import { KafkaMessageAvroStrategy } from './kafka-message-avro.strategy.js';

export class KafkaMessageParseStrategyFactory {
  constructor(private readonly schemaRegistry?: SchemaRegistry) {}

  public create<Payload extends Record<string, any>>(format: MessageFormat): KafkaMessageParseStrategy<Payload> {
    switch (format) {
      case MessageFormat.JSON:
        return new KafkaMessageJsonStrategy<Payload>();
      case MessageFormat.AVRO:
        if (!this.schemaRegistry) {
          throw new Error(
            'Avro message format requires a Schema Registry. ' +
            'Provide "schemaRegistry" options in KafkaModule configuration ' +
            'and install @kafkajs/confluent-schema-registry.',
          );
        }
        return new KafkaMessageAvroStrategy<Payload>(this.schemaRegistry);
      default:
        throw new Error(`Message parse strategy not found for type: ${format}`);
    }
  }
}
