import type { KafkaJS } from '@confluentinc/kafka-javascript';
import { MessageKey, MessageType } from '../../types/message.type.js';
import { KafkaMessageParseStrategy } from './parse-strategies/kafka-message-parse.strategy.js';

export class KafkaMessage<TValue = unknown> implements MessageType<TValue>
{
  readonly value: TValue | null;

  readonly key: MessageKey | null;

  public constructor(key: MessageKey | null, value: TValue | null) {
    this.key = key;
    this.value = value;
  }

  public static from(strategy: KafkaMessageParseStrategy, message: KafkaJS.KafkaMessage): Promise<KafkaMessage> {
    return strategy.parse(message);
  }
}
