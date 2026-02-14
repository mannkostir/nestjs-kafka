import {
  Consumer,
  EachBatchPayload,
  Kafka,
  KafkaJSError,
} from 'kafkajs';
import { MessageType } from '../../types/message.type';
import { ConsumerProxy } from '../../base/consumer-proxy';
import { ConsumerSubscriptionParameters } from '../../types/consumer-subscription-parameters.type';
import { MessageHandlerCallback } from '../../types/message-handler-callback.type';
import { KafkaMessage } from './kafka-message';
import { SchemaRegistry } from '@kafkajs/confluent-schema-registry';
import { MessageFormat } from '../../types/message-format.type';
import { MessageErrorHandlingConfig } from '../../types/message-error-handling.type';
import { KafkaMessageParseStrategy } from './parse-strategies/kafka-message-parse.strategy';
import { KafkaMessageJsonStrategy } from './parse-strategies/kafka-message-json.strategy';
import { KafkaMessageAvroStrategy } from './parse-strategies/kafka-message-avro.strategy';
import { KafkaErrorHandleStrategy } from './error-handle-strategies/kafka-error-handle.strategy';
import { KafkaErrorHandleDlqStrategy } from './error-handle-strategies/kafka-error-handle-dlq.strategy';
import { KafkaErrorHandleIgnoreStrategy } from './error-handle-strategies/kafka-error-handle-ignore.strategy';
import { KafkaErrorHandleFailStrategy } from './error-handle-strategies/kafka-error-handle-fail.strategy';

export class KafkaConsumer<
  TMessage extends MessageType,
> extends ConsumerProxy<TMessage> {

  constructor(
    private readonly kafka: Kafka,
    private readonly schemaRegistry: SchemaRegistry,
    private readonly namespace?: string,
  ) {
    super();
  }

  private getParseStrategy<Payload extends Record<string, any>>(type: MessageFormat): KafkaMessageParseStrategy<Payload> {
    switch (type) {
      case MessageFormat.JSON:
        return new KafkaMessageJsonStrategy<Payload>();
      case MessageFormat.AVRO:
        return new KafkaMessageAvroStrategy<Payload>(this.schemaRegistry);
      default:
        throw new Error(`Message parse strategy not found for type: ${type}`);
    }
  }

  private buildErrorHandlingStrategy(config: MessageErrorHandlingConfig): KafkaErrorHandleStrategy {
    switch (config.type) {
      case 'fail':
        return new KafkaErrorHandleFailStrategy();
      case 'ignore':
        return new KafkaErrorHandleIgnoreStrategy();
      case 'dlq':
        return new KafkaErrorHandleDlqStrategy(this.kafka, config.topic);
      default:
        throw new Error(`Message error handle strategy not found for type: ${(config as any).type}`);
    }
  }

  public async subscribe(
    subscription: ConsumerSubscriptionParameters,
    cb: MessageHandlerCallback<TMessage>,
    consumerGroupId: string
  ): Promise<void> {
    const consumer = this.kafka.consumer({
      groupId: [this.namespace, consumerGroupId].join('-'),
      allowAutoTopicCreation: true,
      heartbeatInterval: 30000,
      retry: {
        maxRetryTime: 30000,
        initialRetryTime: 300,
        factor: 0.2,
        multiplier: 2,
        retries: 15,
        restartOnFailure: async () => true,
      },
    });

    await consumer.connect();

    await consumer.subscribe({
      fromBeginning: false,
      topics: subscription.topicPatterns.filter(
        Boolean,
      ),
    });

    const errorStrategy = this.buildErrorHandlingStrategy(subscription.errorHandling);

    await this.run(consumer, cb, subscription.messageFormat, errorStrategy);
  }

  private handleBatchByMessage(
    cb: MessageHandlerCallback<TMessage>,
    messageFormat: MessageFormat,
    errorStrategy: KafkaErrorHandleStrategy,
  ) {
    return async (payload: EachBatchPayload) => {
      for (const message of payload.batch.messages) {
        if (!payload.isRunning() || payload.isStale()) {
          break;
        }

        try {
          await cb(
            (await KafkaMessage.from(this.getParseStrategy<TMessage>(messageFormat), message)) as TMessage,
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
    messageFormat: MessageFormat,
    errorStrategy: KafkaErrorHandleStrategy,
  ): Promise<void> {
    await consumer.run({
      eachBatchAutoResolve: false,
      eachBatch: this.handleBatchByMessage(
        cb as MessageHandlerCallback<TMessage>,
        messageFormat,
        errorStrategy,
      ),
    });
  }
}
