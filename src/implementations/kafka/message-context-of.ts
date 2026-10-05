import type { KafkaJS } from '@confluentinc/kafka-javascript';
import { MessageContext } from '../../types/message-context.type.js';

export function messageContextOf(batch: KafkaJS.Batch, message: KafkaJS.KafkaMessage): MessageContext {
  return {
    topic: batch.topic,
    partition: batch.partition,
    offset: message.offset,
    timestamp: message.timestamp,
  };
}
