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
import { KafkaErrorHandleRetryStrategy } from './kafka-error-handle-retry.strategy.js';
import { RetryTopics } from './retry-topics.js';
import { RetryDelayGate } from './retry-delay-gate.js';
import { PausedPartitions } from './paused-partitions.js';

export type ErrorStrategyScope = {
  namespaced: boolean;
  groupId: string;
  topicPatterns: readonly (string | RegExp)[];
};

export class KafkaErrorHandleStrategyFactory {
  private readonly strategyCache = new Map<string, KafkaErrorHandleStrategy>();

  constructor(
    private readonly namespacer: TopicNamespacer,
    private readonly producer?: KafkaJS.Producer,
  ) {}

  public create(config: MessageErrorHandlingConfig, scope: ErrorStrategyScope): KafkaErrorHandleStrategy {
    if (config.type === 'fail') {
      return KafkaErrorHandleStrategyFactory.createFail(config.backoff);
    }

    if (config.type === 'retry') {
      return this.createRetry(config, scope);
    }

    const dlqTopic = this.namespacedDlqTopic(config.type === 'dlq' ? config.topic : undefined, scope.namespaced);

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
      new RedeliveryBackoff(ExponentialBackoff.from(backoff ?? {}, 'fail'), new Logger(RedeliveryBackoff.name)),
    );
  }

  private createRetry(
    config: Extract<MessageErrorHandlingConfig, { type: 'retry' }>,
    scope: ErrorStrategyScope,
  ): KafkaErrorHandleRetryStrategy {
    if (!this.producer) {
      throw new Error(
        'Retry error handling requires a producer. ' +
        'Provide "producer" in KafkaConsumer options.',
      );
    }

    if (scope.topicPatterns.some((pattern) => pattern instanceof RegExp)) {
      throw new Error(
        'Retry error handling derives retry topics from concrete topic names, ' +
        'but the handler subscribes to a pattern. ' +
        "List the topics explicitly, or use { type: 'dlq' } or { type: 'fail' } for pattern handlers.",
      );
    }

    const topics = RetryTopics.for(scope.groupId, config.attempts);
    const schedule = ExponentialBackoff.from(config.backoff ?? {}, 'retry');
    const gate = new RetryDelayGate(topics, new PausedPartitions(new Logger(RetryDelayGate.name)));
    const deadLetters = new KafkaErrorHandleDlqStrategy(
      this.producer,
      this.namespacedDlqTopic(config.dlqTopic, scope.namespaced),
    );

    return new KafkaErrorHandleRetryStrategy(this.producer, topics, schedule, gate, deadLetters);
  }

  private namespacedDlqTopic(topic: string | undefined, namespaced: boolean): string | undefined {
    if (topic && namespaced) {
      return this.namespacer.apply(topic);
    }

    return topic;
  }
}
