import type { KafkaJS } from '@confluentinc/kafka-javascript';
import { Logger, OnModuleDestroy } from '@nestjs/common';
import { KafkaMessage } from '../../types/message.type.js';
import { ConsumerProxy } from '../../base/consumer-proxy.js';
import { ConsumerSubscriptionParameters } from '../../types/consumer-subscription-parameters.type.js';
import { messageContextOf } from './message-context-of.js';
import { MessageHandlerCallback } from '../../types/message-handler-callback.type.js';
import { DecodedMessage } from './decoded-message.js';
import type { SchemaRegistry } from '@kafkajs/confluent-schema-registry';
import { KafkaMessageParseStrategy } from './parse-strategies/kafka-message-parse.strategy.js';
import { KafkaMessageParseStrategyFactory } from './parse-strategies/kafka-message-parse-strategy.factory.js';
import { KafkaErrorHandleStrategy } from './error-handle-strategies/kafka-error-handle.strategy.js';
import { KafkaErrorHandleStrategyFactory } from './error-handle-strategies/kafka-error-handle-strategy.factory.js';
import { ConsumerOptions } from '../../types/consumer-options.type.js';
import { TopicNamespacer } from './topic-namespacer.js';
import { LibrdkafkaTopicPattern } from './librdkafka-topic-pattern.js';
import { KafkaTopicProvisioner } from './kafka-topic-provisioner.js';
import { KafkaGroupMember } from './kafka-group-member.js';
import { NestKafkaLogger } from './nest-kafka-logger.js';
import { ResolvedConsumerConfig } from './resolved-consumer-config.js';
import { MessageFormat } from '../../types/message-format.type.js';
import { IConsumeMessageBatches } from '../../interfaces/consume-message-batches.interface.js';
import { MessageBatchHandlerCallback } from '../../types/message-batch-handler-callback.type.js';
import { KafkaBatchDelivery } from './kafka-batch-delivery.js';
import { IConsumeSharedGroups } from '../../interfaces/consume-shared-groups.interface.js';
import { KafkaHandlerRoutes } from './kafka-handler-routes.js';
import { KafkaSharedGroupDispatcher } from './kafka-shared-group-dispatcher.js';
import { RouteDelivery, SharedGroupRoute } from '../../types/shared-group-route.type.js';
import { SubscriptionAborted } from '../../errors/subscription-aborted.js';
import { ConnectorHealthState, GroupObservation } from '../../health/connector-health-state.js';
import { DEFAULT_SHUTDOWN_TIMEOUT_MS, DrainingGroups, settlesWithin } from './shutdown-drain.js';

export interface KafkaConsumerOptions {
  namespace?: string;
  schemaRegistry?: SchemaRegistry;
  producer?: KafkaJS.Producer;
  consumerDefaults?: ConsumerOptions;
  namespacer?: TopicNamespacer;
  topicProvisioner?: KafkaTopicProvisioner;
  clientLogger?: KafkaJS.Logger;
  messageFormat?: MessageFormat;
  shutdownTimeout?: number;
  health?: ConnectorHealthState;
}

type EachBatchHandler = (payload: KafkaJS.EachBatchPayload) => Promise<void>;

type PreparedRoute = {
  handlerName: string;
  config: ResolvedConsumerConfig;
  errorStrategy: KafkaErrorHandleStrategy;
  topicPatterns: (string | RegExp)[];
  topicNames: string[];
  retryTopics: string[];
  sharedRetryTopics: string[];
  requiredTopics: string[];
  eachBatch: EachBatchHandler;
};

type ConsumerSubscription = {
  observation: GroupObservation;
  groupId: string;
  consumer: KafkaJS.Consumer;
  errorStrategies: KafkaErrorHandleStrategy[];
};

export class KafkaConsumer<
  TValue,
> extends ConsumerProxy<TValue> implements OnModuleDestroy, IConsumeMessageBatches<TValue>, IConsumeSharedGroups<TValue> {

  private readonly health: ConnectorHealthState;
  private readonly observedSubscriptions = new Set<ConsumerSubscription>();
  private readonly logger = new Logger(KafkaConsumer.name);
  private readonly namespace?: string;
  private readonly consumerDefaults?: ConsumerOptions;
  private readonly namespacer: TopicNamespacer;
  private readonly topicProvisioner: KafkaTopicProvisioner;
  private readonly clientLogger: KafkaJS.Logger;
  private readonly messageFormat: MessageFormat;
  private readonly parseStrategies: KafkaMessageParseStrategyFactory;
  private readonly errorStrategies: KafkaErrorHandleStrategyFactory;
  private readonly runningSubscriptions: ConsumerSubscription[] = [];
  private readonly stopping = new AbortController();
  private readonly startsInFlight = new Map<Promise<void>, string>();
  private readonly shutdownTimeoutMs: number;

  constructor(
    private readonly kafka: KafkaJS.Kafka,
    options?: KafkaConsumerOptions,
  ) {
    super();
    this.health = options?.health ?? new ConnectorHealthState();
    this.namespace = options?.namespace;
    this.consumerDefaults = options?.consumerDefaults;
    this.namespacer = options?.namespacer ?? new TopicNamespacer();
    this.topicProvisioner = options?.topicProvisioner ?? new KafkaTopicProvisioner(kafka);
    this.clientLogger = options?.clientLogger ?? new NestKafkaLogger();
    this.messageFormat = options?.messageFormat ?? MessageFormat.JSON;
    this.shutdownTimeoutMs = options?.shutdownTimeout ?? DEFAULT_SHUTDOWN_TIMEOUT_MS;
    this.parseStrategies = new KafkaMessageParseStrategyFactory(options?.schemaRegistry);
    this.errorStrategies = new KafkaErrorHandleStrategyFactory(this.namespacer, options?.producer);
  }

  public async subscribe(
    subscription: ConsumerSubscriptionParameters,
    cb: MessageHandlerCallback<TValue>,
    consumerGroupId: string
  ): Promise<void> {
    await this.start(consumerGroupId, [
      { handlerName: consumerGroupId, subscription, delivery: { kind: 'message', handle: cb } },
    ]);
  }

  public async subscribeBatch(
    subscription: ConsumerSubscriptionParameters,
    cb: MessageBatchHandlerCallback<TValue>,
    consumerGroupId: string,
  ): Promise<void> {
    await this.start(consumerGroupId, [
      { handlerName: consumerGroupId, subscription, delivery: { kind: 'batch', handle: cb } },
    ]);
  }

  public async subscribeGroup(
    consumerGroupId: string,
    routes: SharedGroupRoute<TValue>[],
  ): Promise<void> {
    await this.start(consumerGroupId, routes);
  }

  private static dispatcherFor(consumerGroupId: string, prepared: PreparedRoute[]): EachBatchHandler {
    if (prepared.length === 1) {
      return prepared[0].eachBatch;
    }

    const dispatcher = new KafkaSharedGroupDispatcher(
      KafkaHandlerRoutes.claim(
        consumerGroupId,
        prepared.map((route) => ({ topics: [...route.topicPatterns, ...route.retryTopics], route })),
      ),
      new Set(prepared.flatMap((route) => route.sharedRetryTopics)),
    );

    return (payload) => dispatcher.dispatch(payload);
  }

  private async start(consumerGroupId: string, routes: SharedGroupRoute<TValue>[]): Promise<void> {
    const groupId = [this.namespace, consumerGroupId].filter(Boolean).join('-');
    this.assertNotStopping(groupId);
    const observation = this.health.startGroup(groupId);
    const starting = this.startConsumer(consumerGroupId, groupId, routes, observation);
    this.startsInFlight.set(starting, groupId);

    try {
      await starting;
    } catch (error) {
      observation.stopped();
      throw error;
    } finally {
      this.startsInFlight.delete(starting);
    }
  }

  private async startConsumer(
    consumerGroupId: string,
    groupId: string,
    routes: SharedGroupRoute<TValue>[],
    observation: GroupObservation,
  ): Promise<void> {
    this.assertNotStopping(groupId);

    const prepared = routes.map((route) => this.prepare(route, groupId));
    const config = ResolvedConsumerConfig.agreed(consumerGroupId, prepared);
    const eachBatch = KafkaConsumer.dispatcherFor(consumerGroupId, prepared);

    const topicPatterns = prepared.flatMap((route) => route.topicPatterns);
    const topicNames = prepared.flatMap((route) => route.topicNames);
    const retryTopics = prepared.flatMap((route) => route.retryTopics);
    const sharedRetryTopics = [...new Set(prepared.flatMap((route) => route.sharedRetryTopics))];
    const requiredTopics = [...new Set(prepared.flatMap((route) => route.requiredTopics))];

    if (config.createMissingTopics) {
      await this.topicProvisioner.createMissing(requiredTopics);
    } else {
      await this.topicProvisioner.assertExisting(requiredTopics);
    }

    this.assertNotStopping(groupId);

    const member = new KafkaGroupMember(
      this.kafka,
      config.clientConfig(groupId),
      !config.fromBeginning,
      this.clientLogger,
      new Set([...retryTopics, ...sharedRetryTopics]),
      undefined,
      observation,
    );
    const consumer = member.consumer;
    const consumerSubscription: ConsumerSubscription = {
      observation,
      groupId,
      consumer,
      errorStrategies: prepared.map((route) => route.errorStrategy),
    };

    this.observedSubscriptions.add(consumerSubscription);

    try {
      await consumer.connect();
      this.assertNotStopping(groupId);

      const topics: KafkaJS.ConsumerSubscribeTopics = { topics: [...topicPatterns, ...retryTopics, ...sharedRetryTopics] };

      await consumer.subscribe(topics);
      this.assertNotStopping(groupId);

      await this.run(consumer, eachBatch, config.partitionsConsumedConcurrently, observation);

      this.assertNotStopping(groupId);

      if (topicNames.length > 0 || sharedRetryTopics.length > 0) {
        await member.joined(config.joinTimeoutMs(), this.stopping.signal);
      }

      this.assertNotStopping(groupId);
      this.runningSubscriptions.push(consumerSubscription);
    } catch (error) {
      await this.closeFailedSubscription(consumerSubscription);
      throw error;
    }
  }

  private assertNotStopping(groupId: string): void {
    if (this.stopping.signal.aborted) {
      throw new SubscriptionAborted(groupId);
    }
  }

  private prepare({ handlerName, subscription, delivery }: SharedGroupRoute<TValue>, groupId: string): PreparedRoute {
    const namespaced = subscription.namespaced ?? true;

    const parseStrategy = this.parseStrategies.create(
      subscription.messageFormat ?? this.messageFormat,
    );
    const requestedPatterns = subscription.topicPatterns.filter(Boolean);
    requestedPatterns.forEach((pattern) => LibrdkafkaTopicPattern.validate(pattern));

    const topicPatterns = requestedPatterns
      .map((pattern) =>
        namespaced ? this.namespacer.applyPattern(pattern) : pattern,
      )
      .map((pattern) => LibrdkafkaTopicPattern.anchor(pattern));

    const topicNames = topicPatterns.filter(
      (pattern): pattern is string => typeof pattern === 'string',
    );

    const errorStrategy = this.errorStrategies.create(subscription.errorHandling, {
      namespaced,
      groupId,
      concreteTopics: topicNames,
      subscribesToPatterns: topicPatterns.some((pattern) => pattern instanceof RegExp),
    });

    const config = ResolvedConsumerConfig.resolve(subscription.consumer, this.consumerDefaults);

    const retryTopics = errorStrategy.consumedTopics(topicNames);

    return {
      handlerName,
      config,
      errorStrategy,
      topicPatterns,
      topicNames,
      retryTopics,
      sharedRetryTopics: errorStrategy.sharedConsumedTopics(),
      requiredTopics: [...topicNames, ...retryTopics, ...errorStrategy.destinationTopics(topicNames)],
      eachBatch: this.eachBatchFor(delivery, parseStrategy, errorStrategy, groupId),
    };
  }

  private eachBatchFor(
    delivery: RouteDelivery<TValue>,
    parseStrategy: KafkaMessageParseStrategy,
    errorStrategy: KafkaErrorHandleStrategy,
    groupId: string,
  ): EachBatchHandler {
    if (delivery.kind === 'batch') {
      const batchDelivery = new KafkaBatchDelivery(delivery.handle, parseStrategy, errorStrategy, groupId);
      return (payload) => batchDelivery.deliver(payload);
    }

    return this.handleBatchByMessage(delivery.handle, parseStrategy, errorStrategy);
  }

  private async closeFailedSubscription(subscription: ConsumerSubscription): Promise<void> {
    try {
      await this.close(subscription);
    } catch (disconnectError) {
      this.logger.error('Error disconnecting consumer after failed subscribe', disconnectError);
    }
  }

  private async close(subscription: ConsumerSubscription): Promise<void> {
    const { consumer, errorStrategies, observation } = subscription;
    observation.stopped();
    this.observedSubscriptions.delete(subscription);
    errorStrategies.forEach((strategy) => strategy.stop());
    await consumer.disconnect();
  }

  private handleBatchByMessage(
    cb: MessageHandlerCallback<TValue>,
    parseStrategy: KafkaMessageParseStrategy,
    errorStrategy: KafkaErrorHandleStrategy,
  ) {
    return async (payload: KafkaJS.EachBatchPayload) => {
      for (const message of payload.batch.messages) {
        if (!payload.isRunning() || payload.isStale() || errorStrategy.holdUntilDue(payload, message)) {
          break;
        }

        try {
          await cb(
            (await DecodedMessage.from(parseStrategy, message)) as KafkaMessage<TValue>,
            messageContextOf(payload.batch, message),
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
    eachBatch: EachBatchHandler,
    partitionsConsumedConcurrently: number,
    observation: GroupObservation,
  ): Promise<void> {
    await consumer.run({
      eachBatchAutoResolve: false,
      partitionsConsumedConcurrently,
      eachBatch: async (payload) => {
        try {
          await eachBatch(this.untilStopping(payload));
        } catch (error) {
          observation.workerFailed(error);
          throw error;
        }
      },
    });
  }

  private untilStopping(payload: KafkaJS.EachBatchPayload): KafkaJS.EachBatchPayload {
    return {
      ...payload,
      isRunning: () => payload.isRunning() && !this.stopping.signal.aborted,
    };
  }

  public observeHealthAssignments(): void {
    for (const { consumer, observation } of this.observedSubscriptions) {
      if (observation.isJoined()) {
        try {
          observation.assignmentObserved(consumer.assignment());
        } catch (error) {
          observation.workerFailed(error);
          observation.revoked();
        }
      }
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.disconnectAll();
  }

  public async disconnectAll(): Promise<void> {
    this.stopping.abort();
    this.health.stopGroups();

    const draining = new DrainingGroups();

    if (!(await settlesWithin(this.drain(draining), this.shutdownTimeoutMs))) {
      this.logger.warn(
        `Consumer group(s) ${draining.groupIds.join(', ')} still draining after the ${this.shutdownTimeoutMs} ms shutdown timeout; shutting down without waiting for them.`,
      );
    } else {
      this.logger.log('All consumers disconnected');
    }
  }

  private async drain(draining: DrainingGroups): Promise<void> {
    const starting = [...this.startsInFlight].map(([work, groupId]) => draining.track(groupId, work));
    const subscriptions = this.runningSubscriptions.splice(0);

    this.logger.log(`Disconnecting ${subscriptions.length} consumer(s)...`);

    const disconnecting = subscriptions.map((subscription) =>
      draining.track(subscription.groupId, this.close(subscription)),
    );
    const [, results] = await Promise.all([
      Promise.allSettled(starting),
      Promise.allSettled(disconnecting),
    ]);

    for (const result of results) {
      if (result.status === 'rejected') {
        this.logger.error('Error disconnecting consumer', result.reason);
      }
    }
  }
}
