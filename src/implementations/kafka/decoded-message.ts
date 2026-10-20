import type { KafkaJS } from '@confluentinc/kafka-javascript';
import { KafkaMessage, MessageHeaders, MessageKey } from '../../types/message.type.js';
import { KafkaMessageParseStrategy } from './parse-strategies/kafka-message-parse.strategy.js';

export class DecodedMessage<TValue = unknown> implements KafkaMessage<TValue>
{
  readonly value: TValue | null;

  readonly key: MessageKey;

  readonly headers: MessageHeaders;

  public constructor(key: MessageKey, value: TValue | null, headers: MessageHeaders) {
    this.key = key;
    this.value = value;
    this.headers = headers;
  }

  public static from(strategy: KafkaMessageParseStrategy, message: KafkaJS.KafkaMessage): Promise<DecodedMessage> {
    return strategy.parse(message);
  }
}
