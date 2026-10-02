import { KafkaMessageSerializeStrategy } from './kafka-message-serialize.strategy.js';
import { encodeJson } from './encode-json.js';

export class KafkaMessageEnvelopedJsonSerializeStrategy extends KafkaMessageSerializeStrategy {
  public serialize(value: unknown): string {
    return `{"payload":${encodeJson(typeof value === 'string' ? encodeJson(value) : value)}}`;
  }
}
