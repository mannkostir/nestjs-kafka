import type { KafkaJS } from '@confluentinc/kafka-javascript';
import { Logger } from '@nestjs/common';
import { BackoffOptions, MessageErrorHandlingOptions } from '../../../types/message-error-handling.type.js';
import { TopicNamespacer } from '../topic-namespacer.js';
import { KafkaErrorHandleStrategy } from './kafka-error-handle.strategy.js';
import { KafkaErrorHandleDlqStrategy } from './kafka-error-handle-dlq.strategy.js';
import { KafkaErrorHandleIgnoreStrategy } from './kafka-error-handle-ignore.strategy.js';
import { KafkaErrorHandleFailStrategy } from './kafka-error-handle-fail.strategy.js';
import { ExponentialBackoff } from './exponential-backoff.js';
import { RedeliveryBackoff } from './redelivery-backoff.js';
import { KafkaErrorHandleRetryStrategy } from './kafka-error-handle-retry.strategy.js';
import { HandlerRetryTopics } from './handler-retry-topics.js';
import { SourceRetryTopics } from './source-retry-topics.js';
import { GroupRetryTopics } from './group-retry-topics.js';
import { RetryDelayGate } from './retry-delay-gate.js';
import { PausedPartitions } from './paused-partitions.js';
import { PublishFailureBackoff } from './publish-failure-backoff.js';

export type ErrorStrategyScope = {
  namespaced: boolean;
  groupId: string;
  concreteTopics: readonly string[];
  subscribesToPatterns: boolean;
};

export class KafkaErrorHandleStrategyFactory {
  private readonly strategyCache = new Map<string, KafkaErrorHandleStrategy>();

  constructor(
    private readonly namespacer: TopicNamespacer,
    private readonly producer?: KafkaJS.Producer,
  ) {}

  public create(config: MessageErrorHandlingOptions, scope: ErrorStrategyScope): KafkaErrorHandleStrategy {
    if (config.type === 'fail') {
      return KafkaErrorHandleStrategyFactory.createFail(config.backoff);
    }

    if (config.type === 'retry') {
      return this.createRetry(config, scope);
    }

    if (config.type === 'dlq') {
      return this.createDlq(config, scope);
    }

    const cached = this.strategyCache.get(config.type);
    if (cached) {
      return cached;
    }

    let strategy: KafkaErrorHandleStrategy;

    switch (config.type) {
      case 'ignore':
        strategy = new KafkaErrorHandleIgnoreStrategy();
        break;
      default:
        throw new Error(`Message error handle strategy not found for type: ${(config as { type: unknown }).type}`);
    }

    this.strategyCache.set(config.type, strategy);
    return strategy;
  }

  private createDlq(
    config: Extract<MessageErrorHandlingOptions, { type: 'dlq' }>,
    scope: ErrorStrategyScope,
  ): KafkaErrorHandleDlqStrategy {
    if (!this.producer) {
      throw new Error(
        'DLQ error handling requires a producer. ' +
        'Provide "producer" in KafkaConsumer options.',
      );
    }

    return new KafkaErrorHandleDlqStrategy(
      this.producer,
      KafkaErrorHandleStrategyFactory.createPublishBackoff(),
      this.namespacedDlqTopic(config.topic, scope.namespaced),
    );
  }

  private static createPublishBackoff(): PublishFailureBackoff {
    return new PublishFailureBackoff(
      new RedeliveryBackoff(ExponentialBackoff.from({}, 'fail'), new Logger(RedeliveryBackoff.name)),
      new Logger(PublishFailureBackoff.name),
    );
  }

  private static createFail(
    backoff: BackoffOptions | false | undefined,
  ): KafkaErrorHandleFailStrategy {
    if (backoff === false) {
      return new KafkaErrorHandleFailStrategy();
    }

    return new KafkaErrorHandleFailStrategy(
      new RedeliveryBackoff(ExponentialBackoff.from(backoff ?? {}, 'fail'), new Logger(RedeliveryBackoff.name)),
    );
  }

  private createRetry(
    config: Extract<MessageErrorHandlingOptions, { type: 'retry' }>,
    scope: ErrorStrategyScope,
  ): KafkaErrorHandleRetryStrategy {
    if (!this.producer) {
      throw new Error(
        'Retry error handling requires a producer. ' +
        'Provide "producer" in KafkaConsumer options.',
      );
    }

    const topics = new HandlerRetryTopics(
      SourceRetryTopics.for(scope.groupId, config.attempts),
      new Set(scope.concreteTopics),
      scope.subscribesToPatterns ? GroupRetryTopics.for(scope.groupId, config.attempts) : undefined,
    );
    const schedule = ExponentialBackoff.from(config.backoff ?? {}, 'retry');
    const gate = new RetryDelayGate(topics, new PausedPartitions(new Logger(RetryDelayGate.name)));
    const publishBackoff = KafkaErrorHandleStrategyFactory.createPublishBackoff();
    const deadLetters = new KafkaErrorHandleDlqStrategy(
      this.producer,
      publishBackoff,
      this.namespacedDlqTopic(config.dlq?.topic, scope.namespaced),
    );

    return new KafkaErrorHandleRetryStrategy(this.producer, topics, schedule, gate, deadLetters, publishBackoff);
  }

  private namespacedDlqTopic(topic: string | undefined, namespaced: boolean): string | undefined {
    if (topic && namespaced) {
      return this.namespacer.apply(topic);
    }

    return topic;
  }
}
