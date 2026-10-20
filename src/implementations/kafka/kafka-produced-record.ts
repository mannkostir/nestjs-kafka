import type { KafkaJS } from '@confluentinc/kafka-javascript';
import { ProducedRecord } from '../../types/produced-record.type.js';

const LIBRDKAFKA_INVALID_OFFSET = '-1001';

export const toProducedRecord = (metadata: KafkaJS.RecordMetadata): ProducedRecord => ({
  topic: metadata.topicName,
  partition: metadata.partition,
  offset: metadata.baseOffset ?? metadata.offset ?? LIBRDKAFKA_INVALID_OFFSET,
});
