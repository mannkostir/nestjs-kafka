import type { KafkaJS } from '@confluentinc/kafka-javascript';
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
import { LibrdkafkaTopicPattern } from './librdkafka-topic-pattern.js';
import { KafkaTopicProvisioner } from './kafka-topic-provisioner.js';
import { KafkaGroupMember } from './kafka-group-member.js';

export interface KafkaConsumerOptions {
  namespace?: string;
  schemaRegistry?: SchemaRegistry;
  producer?: KafkaJS.Producer;
  consumerDefaults?: ConsumerConfig;
  namespacer?: TopicNamespacer;
  topicProvisioner?: KafkaTopicProvisioner;
}

export class KafkaConsumer<
  TMessage extends MessageType,
> extends ConsumerProxy<TMessage> implements OnModuleDestroy {

  private readonly logger = new Logger(KafkaConsumer.name);
  private readonly schemaRegistry?: SchemaRegistry;
  private readonly namespace?: string;
  private readonly producer?: KafkaJS.Producer;
  private readonly consumerDefaults?: ConsumerConfig;
  private readonly namespacer: TopicNamespacer;
  private readonly topicProvisioner: KafkaTopicProvisioner;
  private readonly strategyCache = new Map<string, KafkaErrorHandleStrategy>();
  private readonly consumers: KafkaJS.Consumer[] = [];

  constructor(
    private readonly kafka: KafkaJS.Kafka,
    options?: KafkaConsumerOptions,
  ) {
    super();
    this.schemaRegistry = options?.schemaRegistry;
    this.namespace = options?.namespace;
    this.producer = options?.producer;
    this.consumerDefaults = options?.consumerDefaults;
    this.namespacer = options?.namespacer ?? new TopicNamespacer();
    this.topicProvisioner = options?.topicProvisioner ?? new KafkaTopicProvisioner(kafka);
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

    const topicPatterns = subscription.topicPatterns
      .filter(Boolean)
      .map((pattern) =>
        namespaced ? this.namespacer.applyPattern(pattern) : pattern,
      )
      .map((pattern) => LibrdkafkaTopicPattern.normalize(pattern));

    const defaults = this.consumerDefaults ?? {};
    const overrides = subscription.consumer ?? {};

    const allowAutoTopicCreation =
      overrides.allowAutoTopicCreation ?? defaults.allowAutoTopicCreation ?? true;

    const topicNames = topicPatterns.filter(
      (pattern): pattern is string => typeof pattern === 'string',
    );

    if (allowAutoTopicCreation) {
      await this.topicProvisioner.createMissing(topicNames);
    } else {
      await this.topicProvisioner.assertExisting(topicNames);
    }

    const groupId = [this.namespace, consumerGroupId].filter(Boolean).join('-');
    const fromBeginning = overrides.fromBeginning ?? defaults.fromBeginning ?? false;
    const sessionTimeout = overrides.sessionTimeout ?? defaults.sessionTimeout;
    const rebalanceTimeout = overrides.rebalanceTimeout ?? defaults.rebalanceTimeout;

    const member = new KafkaGroupMember(
      this.kafka,
      KafkaConsumer.withoutUndefined({
        groupId,
        fromBeginning,
        allowAutoTopicCreation,
        heartbeatInterval: overrides.heartbeatInterval ?? defaults.heartbeatInterval,
        sessionTimeout,
        rebalanceTimeout,
        retry: { ...defaults.retry, ...overrides.retry },
      }),
      !fromBeginning,
    );
    const consumer = member.consumer;

    this.consumers.push(consumer);

    try {
      await consumer.connect();

      const topics: KafkaJS.ConsumerSubscribeTopics = { topics: topicPatterns };

      await consumer.subscribe(topics);

      await this.run(consumer, cb, parseStrategy, errorStrategy);
      await member.joined(groupId, KafkaConsumer.joinTimeoutMs(rebalanceTimeout, sessionTimeout));
    } catch (error) {
      await this.closeFailedConsumer(consumer);
      throw error;
    }
  }

  private static readonly DEFAULT_REBALANCE_TIMEOUT_MS = 300000;
  private static readonly DEFAULT_SESSION_TIMEOUT_MS = 30000;

  private static joinTimeoutMs(rebalanceTimeout?: number, sessionTimeout?: number): number {
    return (rebalanceTimeout ?? KafkaConsumer.DEFAULT_REBALANCE_TIMEOUT_MS) +
      (sessionTimeout ?? KafkaConsumer.DEFAULT_SESSION_TIMEOUT_MS);
  }

  private async closeFailedConsumer(consumer: KafkaJS.Consumer): Promise<void> {
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

  private static withoutUndefined<T extends object>(config: T): T {
    return Object.fromEntries(
      Object.entries(config).filter(([, value]) => value !== undefined),
    ) as T;
  }

  private handleBatchByMessage(
    cb: MessageHandlerCallback<TMessage>,
    parseStrategy: KafkaMessageParseStrategy<TMessage>,
    errorStrategy: KafkaErrorHandleStrategy,
  ) {
    return async (payload: KafkaJS.EachBatchPayload) => {
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
        } catch (err) {
          await errorStrategy.handle(err, payload, message);
        }
      }
    };
  }

  private async run(
    consumer: KafkaJS.Consumer,
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
    await this.disconnectAll();
  }

  public async disconnectAll(): Promise<void> {
    const consumers = this.consumers.splice(0);

    this.logger.log(`Disconnecting ${consumers.length} consumer(s)...`);

    const results = await Promise.allSettled(
      consumers.map((consumer) => consumer.disconnect()),
    );

    for (const result of results) {
      if (result.status === 'rejected') {
        this.logger.error('Error disconnecting consumer', result.reason);
      }
    }

    this.logger.log('All consumers disconnected');
  }
}
