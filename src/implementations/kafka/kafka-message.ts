import type { KafkaJS } from '@confluentinc/kafka-javascript';
import { MessageHeaders, MessageKey, MessageType } from '../../types/message.type.js';
import { KafkaMessageParseStrategy } from './parse-strategies/kafka-message-parse.strategy.js';

export class KafkaMessage<TValue = unknown> implements MessageType<TValue>
{
  readonly value: TValue | null;

  readonly key: MessageKey | null;

  readonly headers: MessageHeaders;

  public constructor(key: MessageKey | null, value: TValue | null, headers: MessageHeaders) {
    this.key = key;
    this.value = value;
    this.headers = headers;
  }

  public static from(strategy: KafkaMessageParseStrategy, message: KafkaJS.KafkaMessage): Promise<KafkaMessage> {
    return strategy.parse(message);
  }
}
