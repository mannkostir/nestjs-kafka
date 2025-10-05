import { KafkaMessage as KafkaJSMessage } from 'kafkajs';
import { MessageKey, MessageType, MessageValue } from '../../types/message.type';

export class KafkaMessage<
  Payload extends Record<string, string | boolean | number>,
> implements MessageType<Payload>
{
  readonly value: MessageValue<Payload> | null;

  readonly key: MessageKey | null;

  private constructor(key: MessageKey | null, value: MessageValue<Payload> | null) {
    this.key = key;
    this.value = value;
  }

  public static async fromJson<
    Payload extends Record<string, string | boolean | number>,
  >(message: KafkaJSMessage): Promise<KafkaMessage<Payload>> {
    let value: MessageValue<Payload> | null = null;
    let key: MessageKey | null = null;

    if (message.value) {
      try {
        value = JSON.parse(message.value.toString());
      } catch (error) {
        value = null;
      }

      if (value && value.payload && typeof value.payload === 'string') {
        value.payload = JSON.parse(value.payload);
      }
    }
    if (message.key) {
      const processedKey = Buffer.isBuffer(message.key)
        ? message.key.toString('utf8')
        : message.key;

      key = JSON.parse(processedKey);
    }

    return new KafkaMessage<Payload>(key, value);
  }
}
