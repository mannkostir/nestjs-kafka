import { KafkaJS } from '@confluentinc/kafka-javascript';
import { toKafkaClientConfig } from './kafka-client-config.js';
import { NestKafkaLogger } from './nest-kafka-logger.js';

const hostLogger = (): KafkaJS.Logger => ({
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
  namespace: jest.fn(),
  setLogLevel: jest.fn(),
});

describe('toKafkaClientConfig', () => {
  it('gives the client a Nest logger when none is configured', () => {
    const config = toKafkaClientConfig({ kafkaJS: { brokers: ['localhost:9092'] } });

    expect(config.kafkaJS?.logger).toBeInstanceOf(NestKafkaLogger);
  });

  it('gives the client a Nest logger when the options have no kafkaJS block', () => {
    const config = toKafkaClientConfig({ 'bootstrap.servers': 'localhost:9092' });

    expect(config.kafkaJS?.logger).toBeInstanceOf(NestKafkaLogger);
  });

  it('keeps an explicitly configured logger', () => {
    const logger = hostLogger();

    const config = toKafkaClientConfig({ kafkaJS: { brokers: ['localhost:9092'], logger } });

    expect(config.kafkaJS?.logger).toBe(logger);
  });

  it('keeps the other client options', () => {
    const config = toKafkaClientConfig({
      'bootstrap.servers': 'localhost:9092',
      kafkaJS: { brokers: ['localhost:9092'], clientId: 'orders' },
    });

    expect(config).toEqual({
      'bootstrap.servers': 'localhost:9092',
      kafkaJS: { brokers: ['localhost:9092'], clientId: 'orders', logger: expect.any(NestKafkaLogger) },
    });
  });

  it('does not change the host options', () => {
    const options = { kafkaJS: { brokers: ['localhost:9092'] } };

    toKafkaClientConfig(options);

    expect(options).toEqual({ kafkaJS: { brokers: ['localhost:9092'] } });
  });
});
