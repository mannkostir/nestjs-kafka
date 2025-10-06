import {
  Consumer,
  EachBatchPayload,
  Kafka,
} from 'kafkajs';
import { MessageType } from '../../types/message.type';
import { ConsumerProxy } from '../../base/consumer-proxy';
import { ConsumerSubscriptionParameters } from '../../types/consumer-subscription-parameters.type';
import { MessageHandlerCallback } from '../../types/message-handler-callback.type';
import { KafkaMessage } from './kafka-message';
import { SchemaRegistry } from '@kafkajs/confluent-schema-registry';
import { MessageFormat } from '../../types/message-format.type';
import { KafkaMessageParseStrategy } from './parse-strategies/kafka-message-parse.strategy';
import { KafkaMessageJsonStrategy } from './parse-strategies/kafka-message-json.strategy';
import { KafkaMessageAvroStrategy } from './parse-strategies/kafka-message-avro.strategy';

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

    await this.run(consumer, cb, subscription.messageFormat);
  }

  private handleBatchByMessage(
    cb: MessageHandlerCallback<TMessage>,
    messageFormat: MessageFormat
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
          throw err;
        }
      }
    };
  }

  private async run(
    consumer: Consumer,
    cb: MessageHandlerCallback<TMessage>,
    messageFormat: MessageFormat
  ): Promise<void> {
    await consumer.run({
      eachBatchAutoResolve: false,
      eachBatch: this.handleBatchByMessage(
        cb as MessageHandlerCallback<TMessage>,
        messageFormat
      ),
    });
  }
}
