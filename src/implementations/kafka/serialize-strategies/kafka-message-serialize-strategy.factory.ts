import { MessageFormat } from '../../../types/message-format.type.js';
import { KafkaMessageSerializeStrategy } from './kafka-message-serialize.strategy.js';
import { KafkaMessageJsonSerializeStrategy } from './kafka-message-json-serialize.strategy.js';
import { KafkaMessageEnvelopedJsonSerializeStrategy } from './kafka-message-enveloped-json-serialize.strategy.js';

export class KafkaMessageSerializeStrategyFactory {
  public create(format: MessageFormat): KafkaMessageSerializeStrategy {
    switch (format) {
      case MessageFormat.JSON:
        return new KafkaMessageJsonSerializeStrategy();
      case MessageFormat.ENVELOPED_JSON:
        return new KafkaMessageEnvelopedJsonSerializeStrategy();
      case MessageFormat.AVRO:
        throw new Error(
          'Producing Avro messages is not supported yet. ' +
          'Send with messageFormat MessageFormat.JSON or MessageFormat.ENVELOPED_JSON.',
        );
      default:
        throw new Error(`Message serialize strategy not found for type: ${format}`);
    }
  }
}
