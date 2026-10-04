import { KafkaMessageSerializeStrategy } from './kafka-message-serialize.strategy.js';
import { encodeJson } from './encode-json.js';

export class KafkaMessageJsonSerializeStrategy extends KafkaMessageSerializeStrategy {
  public async serialize(value: unknown): Promise<string | null> {
    return value === null ? null : encodeJson(value);
  }
}
