import { KafkaJS } from '@confluentinc/kafka-javascript';
import { ProducerCompression, ProducerConfig } from '../../types/producer-config.type.js';

const DEFAULT_ALLOW_AUTO_TOPIC_CREATION = false;

const IDEMPOTENT_ACKS = -1;

const CLIENT_COMPRESSION: Record<ProducerCompression, KafkaJS.CompressionTypes> = {
  none: KafkaJS.CompressionTypes.None,
  gzip: KafkaJS.CompressionTypes.GZIP,
  snappy: KafkaJS.CompressionTypes.Snappy,
  lz4: KafkaJS.CompressionTypes.LZ4,
  zstd: KafkaJS.CompressionTypes.ZSTD,
};

const PRODUCER_COMPRESSIONS: readonly string[] = Object.keys(CLIENT_COMPRESSION);

const isProducerCompression = (value: string): value is ProducerCompression =>
  PRODUCER_COMPRESSIONS.includes(value);

const toClientCompression = (compression: string): KafkaJS.CompressionTypes => {
  if (!isProducerCompression(compression)) {
    throw new Error(
      `KafkaModule "producer.compression" must be one of ${PRODUCER_COMPRESSIONS.join(', ')}. Use one of those codecs or leave it unset for the client default.`,
    );
  }
  return CLIENT_COMPRESSION[compression];
};

const rejectIdempotentAcksConflict = (config: ProducerConfig | undefined): void => {
  if (config?.idempotent === true && config.acks !== undefined && config.acks !== IDEMPOTENT_ACKS) {
    throw new Error(
      `KafkaModule "producer.acks" must be ${IDEMPOTENT_ACKS} when "producer.idempotent" is true. Set acks to ${IDEMPOTENT_ACKS}, leave it unset, or turn idempotence off.`,
    );
  }
};

export const toClientProducerConfig = (config: ProducerConfig | undefined): KafkaJS.ProducerConfig => {
  rejectIdempotentAcksConflict(config);

  return {
    allowAutoTopicCreation: config?.allowAutoTopicCreation ?? DEFAULT_ALLOW_AUTO_TOPIC_CREATION,
    ...(config?.idempotent !== undefined && { idempotent: config.idempotent }),
    ...(config?.acks !== undefined && { acks: config.acks }),
    ...(config?.compression !== undefined && { compression: toClientCompression(config.compression) }),
  };
};
