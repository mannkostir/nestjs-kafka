import {
  Consumer,
  ConsumerSubscribeTopics,
  EachBatchPayload,
  Kafka,
  KafkaJSError,
  Producer,
} from 'kafkajs';
import { Logger, OnModuleDestroy } from '@nestjs/common';
import { MessageType } from '../../types/message.type.js';
import { ConsumerProxy } from '../../base/consumer-proxy.js';
import { ConsumerSubscriptionParameters } from '../../types/consumer-subscription-parameters.type.js';
import { MessageHandlerCallback } from '../../types/message-handler-callback.type.js';
import { KafkaMessage } from './kafka-message.js';
import type { SchemaRegistry } from '@kafkajs/confluent-schema-registry';
import { MessageFormat } from '../../types/message-format.type.js';
import { MessageErrorHandlingConfig } from '../../types/message-error-handling.type.js';
import { KafkaMessageParseStrategy } from './parse-strategies/kafka-message-parse.strategy.js';
import { KafkaMessageJsonStrategy } from './parse-strategies/kafka-message-json.strategy.js';
import { KafkaMessageAvroStrategy } from './parse-strategies/kafka-message-avro.strategy.js';
import { KafkaErrorHandleStrategy } from './error-handle-strategies/kafka-error-handle.strategy.js';
import { KafkaErrorHandleDlqStrategy } from './error-handle-strategies/kafka-error-handle-dlq.strategy.js';
import { KafkaErrorHandleIgnoreStrategy } from './error-handle-strategies/kafka-error-handle-ignore.strategy.js';
import { KafkaErrorHandleFailStrategy } from './error-handle-strategies/kafka-error-handle-fail.strategy.js';
import { ConsumerConfig } from '../../types/consumer-config.type.js';
import { TopicNamespacer } from './topic-namespacer.js';

export interface KafkaConsumerOptions {
  namespace?: string;
  schemaRegistry?: SchemaRegistry;
  producer?: Producer;
  consumerDefaults?: ConsumerConfig;
  namespacer?: TopicNamespacer;
}

export class KafkaConsumer<
  TMessage extends MessageType,
> extends ConsumerProxy<TMessage> implements OnModuleDestroy {

  private static readonly TOPIC_CREATION_MAX_RETRIES = 5;
  private static readonly TOPIC_CREATION_INITIAL_DELAY_MS = 100;
  private static readonly TOPIC_CREATION_BACKOFF_MULTIPLIER = 2;
  private static readonly TOPIC_CREATION_MAX_DELAY_MS = 1000;

  private readonly logger = new Logger(KafkaConsumer.name);
  private readonly schemaRegistry?: SchemaRegistry;
  private readonly namespace?: string;
  private readonly producer?: Producer;
  private readonly consumerDefaults?: ConsumerConfig;
  private readonly namespacer: TopicNamespacer;
  private readonly strategyCache = new Map<string, KafkaErrorHandleStrategy>();
  private readonly consumers: Consumer[] = [];

  constructor(
    private readonly kafka: Kafka,
    options?: KafkaConsumerOptions,
  ) {
    super();
    this.schemaRegistry = options?.schemaRegistry;
    this.namespace = options?.namespace;
    this.producer = options?.producer;
    this.consumerDefaults = options?.consumerDefaults;
    this.namespacer = options?.namespacer ?? new TopicNamespacer();
  }

  private getParseStrategy<Payload extends Record<string, any>>(type: MessageFormat): KafkaMessageParseStrategy<Payload> {
    switch (type) {
      case MessageFormat.JSON:
        return new KafkaMessageJsonStrategy<Payload>();
      case MessageFormat.AVRO:
        if (!this.schemaRegistry) {
          throw new Error(
            'Avro message format requires a Schema Registry. ' +
            'Provide "schemaRegistry" options in KafkaModule configuration ' +
            'and install @kafkajs/confluent-schema-registry.',
          );
        }
        return new KafkaMessageAvroStrategy<Payload>(this.schemaRegistry);
      default:
        throw new Error(`Message parse strategy not found for type: ${type}`);
    }
  }

  private buildErrorHandlingStrategy(
    config: MessageErrorHandlingConfig,
    namespaced: boolean,
  ): KafkaErrorHandleStrategy {
    const dlqTopic = this.resolveDlqTopic(config, namespaced);

    const cacheKey = config.type === 'dlq' ? `dlq:${dlqTopic ?? ''}` : config.type;

    const cached = this.strategyCache.get(cacheKey);
    if (cached) {
      return cached;
    }

    let strategy: KafkaErrorHandleStrategy;

    switch (config.type) {
      case 'fail':
        strategy = new KafkaErrorHandleFailStrategy();
        break;
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
        throw new Error(`Message error handle strategy not found for type: ${(config as any).type}`);
    }

    this.strategyCache.set(cacheKey, strategy);
    return strategy;
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

  public async subscribe(
    subscription: ConsumerSubscriptionParameters,
    cb: MessageHandlerCallback<TMessage>,
    consumerGroupId: string
  ): Promise<void> {
    const namespaced = subscription.namespaced ?? true;

    const parseStrategy = this.getParseStrategy<TMessage>(subscription.messageFormat);
    const errorStrategy = this.buildErrorHandlingStrategy(
      subscription.errorHandling,
      namespaced,
    );

    const defaults = this.consumerDefaults ?? {};
    const overrides = subscription.consumer ?? {};

    const effectiveRetry = {
      maxRetryTime: 30000,
      initialRetryTime: 300,
      factor: 0.2,
      multiplier: 2,
      retries: 15,
      restartOnFailure: async () => true,
      ...defaults.retry,
      ...overrides.retry,
    };

    const allowAutoTopicCreation =
      overrides.allowAutoTopicCreation ?? defaults.allowAutoTopicCreation ?? true;

    const consumer = this.kafka.consumer({
      groupId: [this.namespace, consumerGroupId].filter(Boolean).join('-'),
      allowAutoTopicCreation,
      heartbeatInterval: overrides.heartbeatInterval ?? defaults.heartbeatInterval,
      sessionTimeout: overrides.sessionTimeout ?? defaults.sessionTimeout,
      rebalanceTimeout: overrides.rebalanceTimeout ?? defaults.rebalanceTimeout,
      retry: effectiveRetry,
    });

    this.consumers.push(consumer);

    try {
      await consumer.connect();

      const topics: ConsumerSubscribeTopics = {
        fromBeginning: overrides.fromBeginning ?? defaults.fromBeginning ?? false,
        topics: subscription.topicPatterns
          .filter(Boolean)
          .map((pattern) =>
            namespaced ? this.namespacer.applyPattern(pattern) : pattern,
          ),
      };

      if (allowAutoTopicCreation) {
        await this.subscribeAwaitingTopicCreation(consumer, topics);
      } else {
        await consumer.subscribe(topics);
      }

      await this.run(consumer, cb, parseStrategy, errorStrategy);
    } catch (error) {
      await this.closeFailedConsumer(consumer);
      throw error;
    }
  }

  private async closeFailedConsumer(consumer: Consumer): Promise<void> {
    const index = this.consumers.indexOf(consumer);
    if (index !== -1) {
      this.consumers.splice(index, 1);
    }

    try {
      await consumer.disconnect();
    } catch (disconnectError) {
      this.logger.error('Error disconnecting consumer after failed subscribe', disconnectError);
    }
  }

  private async subscribeAwaitingTopicCreation(
    consumer: Consumer,
    topics: ConsumerSubscribeTopics,
  ): Promise<void> {
    for (let attempt = 0; ; attempt++) {
      try {
        await consumer.subscribe(topics);
        return;
      } catch (error) {
        if (
          !KafkaConsumer.isTopicAwaitingCreation(error) ||
          attempt >= KafkaConsumer.TOPIC_CREATION_MAX_RETRIES
        ) {
          throw error;
        }
        this.logger.warn(
          `Topic(s) ${topics.topics.join(', ')} not found yet, awaiting auto-creation (attempt ${attempt + 1}/${KafkaConsumer.TOPIC_CREATION_MAX_RETRIES})`,
        );
        await KafkaConsumer.delay(
          Math.min(
            KafkaConsumer.TOPIC_CREATION_INITIAL_DELAY_MS *
              KafkaConsumer.TOPIC_CREATION_BACKOFF_MULTIPLIER ** attempt,
            KafkaConsumer.TOPIC_CREATION_MAX_DELAY_MS,
          ),
        );
      }
    }
  }

  private static isTopicAwaitingCreation(error: unknown): boolean {
    return (error as { type?: unknown }).type === 'UNKNOWN_TOPIC_OR_PARTITION';
  }

  private static delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private handleBatchByMessage(
    cb: MessageHandlerCallback<TMessage>,
    parseStrategy: KafkaMessageParseStrategy<TMessage>,
    errorStrategy: KafkaErrorHandleStrategy,
  ) {
    return async (payload: EachBatchPayload) => {
      for (const message of payload.batch.messages) {
        if (!payload.isRunning() || payload.isStale()) {
          break;
        }

        try {
          await cb(
            (await KafkaMessage.from(parseStrategy, message)) as TMessage,
            payload.batch.topic,
          );

          payload.resolveOffset(message.offset);

          await payload.heartbeat();
        } catch (err) {
          await errorStrategy.handle(err as KafkaJSError, payload, message);
        }
      }
    };
  }

  private async run(
    consumer: Consumer,
    cb: MessageHandlerCallback<TMessage>,
    parseStrategy: KafkaMessageParseStrategy<TMessage>,
    errorStrategy: KafkaErrorHandleStrategy,
  ): Promise<void> {
    await consumer.run({
      eachBatchAutoResolve: false,
      eachBatch: this.handleBatchByMessage(
        cb as MessageHandlerCallback<TMessage>,
        parseStrategy,
        errorStrategy,
      ),
    });
  }

  async onModuleDestroy(): Promise<void> {
    this.logger.log(`Disconnecting ${this.consumers.length} consumer(s)...`);

    const results = await Promise.allSettled(
      this.consumers.map((consumer) => consumer.disconnect()),
    );

    for (const result of results) {
      if (result.status === 'rejected') {
        this.logger.error('Error disconnecting consumer', result.reason);
      }
    }

    this.logger.log('All consumers disconnected');
  }
}
