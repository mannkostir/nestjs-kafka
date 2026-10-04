export type ProducerCompression = 'none' | 'gzip' | 'snappy' | 'lz4' | 'zstd';

export type ProducerConfig = {
  allowAutoTopicCreation?: boolean;
  idempotent?: boolean;
  compression?: ProducerCompression;
  acks?: number;
};
