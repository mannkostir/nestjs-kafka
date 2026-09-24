import {
  Consumer,
  EachBatchPayload,
  Kafka,
  KafkaJSError,
  Producer,
} from 'kafkajs';
import { BeforeApplicationShutdown, Logger } from '@nestjs/common';
import { MessageType } from '../../types/message.type';
import { ConsumerProxy } from '../../base/consumer-proxy';
import { ConsumerSubscriptionParameters } from '../../types/consumer-subscription-parameters.type';
import { MessageHandlerCallback } from '../../types/message-handler-callback.type';
import { KafkaMessage } from './kafka-message';
import type { SchemaRegistry } from '@kafkajs/confluent-schema-registry';
import { MessageFormat } from '../../types/message-format.type';
import { MessageErrorHandlingConfig } from '../../types/message-error-handling.type';
import { KafkaMessageParseStrategy } from './parse-strategies/kafka-message-parse.strategy';
import { KafkaMessageJsonStrategy } from './parse-strategies/kafka-message-json.strategy';
import { KafkaMessageAvroStrategy } from './parse-strategies/kafka-message-avro.strategy';
import { KafkaErrorHandleStrategy } from './error-handle-strategies/kafka-error-handle.strategy';
import { KafkaErrorHandleDlqStrategy } from './error-handle-strategies/kafka-error-handle-dlq.strategy';
import { KafkaErrorHandleIgnoreStrategy } from './error-handle-strategies/kafka-error-handle-ignore.strategy';
import { KafkaErrorHandleFailStrategy } from './error-handle-strategies/kafka-error-handle-fail.strategy';
import { ConsumerConfig } from '../../types/consumer-config.type';
import { TopicNamespacer } from './topic-namespacer';

export interface KafkaConsumerOptions {
  namespace?: string;
  schemaRegistry?: SchemaRegistry;
  producer?: Producer;
  consumerDefaults?: ConsumerConfig;
  namespacer?: TopicNamespacer;
}

export class KafkaConsumer<
  TMessage extends MessageType,
> extends ConsumerProxy<TMessage> implements BeforeApplicationShutdown {

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
    const dlqTopic =
      config.type === 'dlq' && config.topic && namespaced
        ? this.namespacer.apply(config.topic)
        : config.type === 'dlq'
          ? config.topic
          : undefined;

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

    const consumer = this.kafka.consumer({
      groupId: [this.namespace, consumerGroupId].filter(Boolean).join('-'),
      allowAutoTopicCreation: overrides.allowAutoTopicCreation ?? defaults.allowAutoTopicCreation ?? true,
      heartbeatInterval: overrides.heartbeatInterval ?? defaults.heartbeatInterval,
      sessionTimeout: overrides.sessionTimeout ?? defaults.sessionTimeout,
      rebalanceTimeout: overrides.rebalanceTimeout ?? defaults.rebalanceTimeout,
      retry: effectiveRetry,
    });

    this.consumers.push(consumer);

    await consumer.connect();

    await consumer.subscribe({
      fromBeginning: overrides.fromBeginning ?? defaults.fromBeginning ?? false,
      topics: subscription.topicPatterns
        .filter(Boolean)
        .map((pattern) =>
          namespaced ? this.namespacer.applyPattern(pattern) : pattern,
        ),
    });

    await this.run(consumer, cb, parseStrategy, errorStrategy);
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

  async beforeApplicationShutdown(): Promise<void> {
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
