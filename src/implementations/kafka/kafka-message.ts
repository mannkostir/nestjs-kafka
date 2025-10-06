import { KafkaMessage as KafkaJSMessage } from 'kafkajs';
import { MessageKey, MessageType, MessageValue } from '../../types/message.type';
import { KafkaMessageParseStrategy } from './parse-strategies/kafka-message-parse.strategy';

export class KafkaMessage<
  Payload extends Record<string, any>,
> implements MessageType<Payload>
{
  readonly value: MessageValue<Payload> | null;

  readonly key: MessageKey | null;

  public constructor(key: MessageKey | null, value: MessageValue<Payload> | null) {
    this.key = key;
    this.value = value;
  }

  public static from<Payload extends Record<string, any>>(strategy: KafkaMessageParseStrategy<Payload>, message: KafkaJSMessage): Promise<KafkaMessage<Payload>> {
    return strategy.parse(message);
  }
}
