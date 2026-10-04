import { KafkaJS } from '@confluentinc/kafka-javascript';
import { toClientProducerConfig } from './kafka-producer-config.js';
import { ProducerCompression } from '../../types/producer-config.type.js';

describe('toClientProducerConfig', () => {
  it('disables auto topic creation when nothing is configured', () => {
    expect(toClientProducerConfig(undefined)).toEqual({ allowAutoTopicCreation: false });
  });

  it('omits unset fields from the client config', () => {
    expect(Object.keys(toClientProducerConfig({}))).toEqual(['allowAutoTopicCreation']);
  });

  it('omits fields explicitly set to undefined from the client config', () => {
    expect(
      Object.keys(toClientProducerConfig({ idempotent: undefined, acks: undefined, compression: undefined })),
    ).toEqual(['allowAutoTopicCreation']);
  });

  it('passes auto topic creation through', () => {
    expect(toClientProducerConfig({ allowAutoTopicCreation: true })).toEqual({ allowAutoTopicCreation: true });
  });

  it('passes idempotence through', () => {
    expect(toClientProducerConfig({ idempotent: true })).toEqual({
      allowAutoTopicCreation: false,
      idempotent: true,
    });
  });

  it('passes disabled idempotence through', () => {
    expect(toClientProducerConfig({ idempotent: false })).toEqual({
      allowAutoTopicCreation: false,
      idempotent: false,
    });
  });

  it('passes acks through', () => {
    expect(toClientProducerConfig({ acks: 1 })).toEqual({
      allowAutoTopicCreation: false,
      acks: 1,
    });
  });

  it.each<[ProducerCompression, KafkaJS.CompressionTypes]>([
    ['none', KafkaJS.CompressionTypes.None],
    ['gzip', KafkaJS.CompressionTypes.GZIP],
    ['snappy', KafkaJS.CompressionTypes.Snappy],
    ['lz4', KafkaJS.CompressionTypes.LZ4],
    ['zstd', KafkaJS.CompressionTypes.ZSTD],
  ])('maps %s compression to the client codec', (compression, codec) => {
    expect(toClientProducerConfig({ compression })).toEqual({
      allowAutoTopicCreation: false,
      compression: codec,
    });
  });

  it('rejects an unknown compression', () => {
    expect(() =>
      toClientProducerConfig({ compression: 'brotli' as ProducerCompression }),
    ).toThrow(
      'KafkaModule "producer.compression" must be one of none, gzip, snappy, lz4, zstd. Use one of those codecs or leave it unset for the client default.',
    );
  });
});
