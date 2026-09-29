import type { KafkaJS } from '@confluentinc/kafka-javascript';
import { Logger } from '@nestjs/common';
import { FailBackoffOptions, MessageErrorHandlingConfig } from '../../../types/message-error-handling.type.js';
import { TopicNamespacer } from '../topic-namespacer.js';
import { KafkaErrorHandleStrategy } from './kafka-error-handle.strategy.js';
import { KafkaErrorHandleDlqStrategy } from './kafka-error-handle-dlq.strategy.js';
import { KafkaErrorHandleIgnoreStrategy } from './kafka-error-handle-ignore.strategy.js';
import { KafkaErrorHandleFailStrategy } from './kafka-error-handle-fail.strategy.js';
import { ExponentialBackoff } from './exponential-backoff.js';
import { RedeliveryBackoff } from './redelivery-backoff.js';

export class KafkaErrorHandleStrategyFactory {
  private readonly strategyCache = new Map<string, KafkaErrorHandleStrategy>();

  constructor(
    private readonly namespacer: TopicNamespacer,
    private readonly producer?: KafkaJS.Producer,
  ) {}

  public create(config: MessageErrorHandlingConfig, namespaced: boolean): KafkaErrorHandleStrategy {
    if (config.type === 'fail') {
      return KafkaErrorHandleStrategyFactory.createFail(config.backoff);
    }

    const dlqTopic = this.resolveDlqTopic(config, namespaced);

    const cacheKey = config.type === 'dlq' ? `dlq:${dlqTopic ?? ''}` : config.type;

    const cached = this.strategyCache.get(cacheKey);
    if (cached) {
      return cached;
    }

    let strategy: KafkaErrorHandleStrategy;

    switch (config.type) {
      case 'ignore':
        strategy = new KafkaErrorHandleIgnoreStrategy();
        break;
      case 'dlq':
        if (!this.producer) {
          throw new Error(
            'DLQ error handling requires a producer. ' +
            'Provide "producer" in KafkaConsumer options.',
          );
        }
        strategy = new KafkaErrorHandleDlqStrategy(this.producer, dlqTopic);
        break;
      default:
        throw new Error(`Message error handle strategy not found for type: ${(config as { type: unknown }).type}`);
    }

    this.strategyCache.set(cacheKey, strategy);
    return strategy;
  }

  private static createFail(
    backoff: FailBackoffOptions | false | undefined,
  ): KafkaErrorHandleFailStrategy {
    if (backoff === false) {
      return new KafkaErrorHandleFailStrategy();
    }

    return new KafkaErrorHandleFailStrategy(
      new RedeliveryBackoff(ExponentialBackoff.from(backoff ?? {}), new Logger(RedeliveryBackoff.name)),
    );
  }

  private resolveDlqTopic(
    config: MessageErrorHandlingConfig,
    namespaced: boolean,
  ): string | undefined {
    if (config.type !== 'dlq') {
      return undefined;
    }

    if (config.topic && namespaced) {
      return this.namespacer.apply(config.topic);
    }

    return config.topic;
  }
}
