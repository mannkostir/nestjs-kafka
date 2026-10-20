export type ProducerCompression = 'none' | 'gzip' | 'snappy' | 'lz4' | 'zstd';

export type ProducerOptions = {
  allowAutoTopicCreation?: boolean;
  idempotent?: boolean;
  compression?: ProducerCompression;
  acks?: -1 | 0 | 1;
};
