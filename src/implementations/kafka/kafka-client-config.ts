import { KafkaJS } from '@confluentinc/kafka-javascript';
import { NestKafkaLogger } from './nest-kafka-logger.js';

export function toKafkaClientConfig(
  options: KafkaJS.CommonConstructorConfig,
): KafkaJS.CommonConstructorConfig {
  if (options.kafkaJS?.logger) {
    return options;
  }

  const kafkaJS = { ...options.kafkaJS, logger: new NestKafkaLogger() };

  return { ...options, kafkaJS } as KafkaJS.CommonConstructorConfig;
}
