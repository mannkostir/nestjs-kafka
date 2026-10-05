import type { KafkaJS } from '@confluentinc/kafka-javascript';
import { Logger, OnModuleDestroy } from '@nestjs/common';
import { MessageType } from '../../types/message.type.js';
import { ConsumerProxy } from '../../base/consumer-proxy.js';
import { ConsumerSubscriptionParameters } from '../../types/consumer-subscription-parameters.type.js';
import { MessageContext } from '../../types/message-context.type.js';
import { MessageHandlerCallback } from '../../types/message-handler-callback.type.js';
import { KafkaMessage } from './kafka-message.js';
import type { SchemaRegistry } from '@kafkajs/confluent-schema-registry';
import { KafkaMessageParseStrategy } from './parse-strategies/kafka-message-parse.strategy.js';
import { KafkaMessageParseStrategyFactory } from './parse-strategies/kafka-message-parse-strategy.factory.js';
import { KafkaErrorHandleStrategy } from './error-handle-strategies/kafka-error-handle.strategy.js';
import { KafkaErrorHandleStrategyFactory } from './error-handle-strategies/kafka-error-handle-strategy.factory.js';
import { ConsumerConfig } from '../../types/consumer-config.type.js';
import { TopicNamespacer } from './topic-namespacer.js';
import { LibrdkafkaTopicPattern } from './librdkafka-topic-pattern.js';
import { KafkaTopicProvisioner } from './kafka-topic-provisioner.js';
import { KafkaGroupMember } from './kafka-group-member.js';
import { NestKafkaLogger } from './nest-kafka-logger.js';
import { ResolvedConsumerConfig } from './resolved-consumer-config.js';
import { MessageFormat } from '../../types/message-format.type.js';

export interface KafkaConsumerOptions {
  namespace?: string;
  schemaRegistry?: SchemaRegistry;
  producer?: KafkaJS.Producer;
  consumerDefaults?: ConsumerConfig;
  namespacer?: TopicNamespacer;
  topicProvisioner?: KafkaTopicProvisioner;
  clientLogger?: KafkaJS.Logger;
  messageFormat?: MessageFormat;
}

type ConsumerSubscription = {
  consumer: KafkaJS.Consumer;
  errorStrategy: KafkaErrorHandleStrategy;
};

export class KafkaConsumer<
  TMessage extends MessageType,
> extends ConsumerProxy<TMessage> implements OnModuleDestroy {

  private readonly logger = new Logger(KafkaConsumer.name);
  private readonly namespace?: string;
  private readonly consumerDefaults?: ConsumerConfig;
  private readonly namespacer: TopicNamespacer;
  private readonly topicProvisioner: KafkaTopicProvisioner;
  private readonly clientLogger: KafkaJS.Logger;
  private readonly messageFormat: MessageFormat;
  private readonly parseStrategies: KafkaMessageParseStrategyFactory;
  private readonly errorStrategies: KafkaErrorHandleStrategyFactory;
  private readonly subscriptions: ConsumerSubscription[] = [];

  constructor(
    private readonly kafka: KafkaJS.Kafka,
    options?: KafkaConsumerOptions,
  ) {
    super();
    this.namespace = options?.namespace;
    this.consumerDefaults = options?.consumerDefaults;
    this.namespacer = options?.namespacer ?? new TopicNamespacer();
    this.topicProvisioner = options?.topicProvisioner ?? new KafkaTopicProvisioner(kafka);
    this.clientLogger = options?.clientLogger ?? new NestKafkaLogger();
    this.messageFormat = options?.messageFormat ?? MessageFormat.JSON;
    this.parseStrategies = new KafkaMessageParseStrategyFactory(options?.schemaRegistry);
    this.errorStrategies = new KafkaErrorHandleStrategyFactory(this.namespacer, options?.producer);
  }

  public async subscribe(
    subscription: ConsumerSubscriptionParameters,
    cb: MessageHandlerCallback<TMessage>,
    consumerGroupId: string
  ): Promise<void> {
    const namespaced = subscription.namespaced ?? true;

    const parseStrategy = this.parseStrategies.create(
      subscription.messageFormat ?? this.messageFormat,
    );
    const errorStrategy = this.errorStrategies.create(subscription.errorHandling, {
      namespaced,
      groupId: consumerGroupId,
      topicPatterns: subscription.topicPatterns,
    });

    const requestedPatterns = subscription.topicPatterns.filter(Boolean);
    requestedPatterns.forEach((pattern) => LibrdkafkaTopicPattern.validate(pattern));

    const topicPatterns = requestedPatterns
      .map((pattern) =>
        namespaced ? this.namespacer.applyPattern(pattern) : pattern,
      )
      .map((pattern) => LibrdkafkaTopicPattern.anchor(pattern));

    const config = ResolvedConsumerConfig.resolve(subscription.consumer, this.consumerDefaults);

    const topicNames = topicPatterns.filter(
      (pattern): pattern is string => typeof pattern === 'string',
    );

    const requiredTopics = [...new Set([...topicNames, ...errorStrategy.destinationTopics(topicNames)])];

    if (config.allowAutoTopicCreation) {
      await this.topicProvisioner.createMissing(requiredTopics);
    } else {
      await this.topicProvisioner.assertExisting(requiredTopics);
    }

    const groupId = [this.namespace, consumerGroupId].filter(Boolean).join('-');

    const member = new KafkaGroupMember(
      this.kafka,
      config.clientConfig(groupId),
      !config.fromBeginning,
      this.clientLogger,
    );
    const consumer = member.consumer;
    const consumerSubscription: ConsumerSubscription = { consumer, errorStrategy };

    this.subscriptions.push(consumerSubscription);

    try {
      await consumer.connect();

      const topics: KafkaJS.ConsumerSubscribeTopics = { topics: topicPatterns };

      await consumer.subscribe(topics);

      await this.run(consumer, cb, parseStrategy, errorStrategy, config.partitionsConsumedConcurrently);

      if (topicNames.length > 0) {
        await member.joined(config.joinTimeoutMs());
      }
    } catch (error) {
      await this.closeFailedSubscription(consumerSubscription);
      throw error;
    }
  }

  private async closeFailedSubscription(subscription: ConsumerSubscription): Promise<void> {
    const index = this.subscriptions.indexOf(subscription);
    if (index !== -1) {
      this.subscriptions.splice(index, 1);
    }

    try {
      await KafkaConsumer.close(subscription);
    } catch (disconnectError) {
      this.logger.error('Error disconnecting consumer after failed subscribe', disconnectError);
    }
  }

  private static contextOf(batch: KafkaJS.Batch, message: KafkaJS.KafkaMessage): MessageContext {
    return {
      topic: batch.topic,
      partition: batch.partition,
      offset: message.offset,
      timestamp: message.timestamp,
    };
  }

  private static async close({ consumer, errorStrategy }: ConsumerSubscription): Promise<void> {
    errorStrategy.stop();
    await consumer.disconnect();
  }

  private handleBatchByMessage(
    cb: MessageHandlerCallback<TMessage>,
    parseStrategy: KafkaMessageParseStrategy,
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
            KafkaConsumer.contextOf(payload.batch, message),
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
    parseStrategy: KafkaMessageParseStrategy,
    errorStrategy: KafkaErrorHandleStrategy,
    partitionsConsumedConcurrently: number,
  ): Promise<void> {
    await consumer.run({
      eachBatchAutoResolve: false,
      partitionsConsumedConcurrently,
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
    const subscriptions = this.subscriptions.splice(0);

    this.logger.log(`Disconnecting ${subscriptions.length} consumer(s)...`);

    const results = await Promise.allSettled(
      subscriptions.map((subscription) => KafkaConsumer.close(subscription)),
    );

    for (const result of results) {
      if (result.status === 'rejected') {
        this.logger.error('Error disconnecting consumer', result.reason);
      }
    }

    this.logger.log('All consumers disconnected');
  }
}
