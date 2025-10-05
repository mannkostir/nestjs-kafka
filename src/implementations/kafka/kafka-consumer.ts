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

export class KafkaConsumer<
  TMessage extends MessageType,
> extends ConsumerProxy<TMessage> {

  constructor(
    private readonly kafka: Kafka,
    private readonly namespace?: string,
  ) {
    super();
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

    await this.run(consumer, cb);
  }

  private handleBatchByMessage(
    cb: MessageHandlerCallback<TMessage>
  ) {
    return async (payload: EachBatchPayload) => {
      for (const message of payload.batch.messages) {
        if (!payload.isRunning() || payload.isStale()) {
          break;
        }

        try {
          await cb(
            (await KafkaMessage.fromJson(message)) as TMessage,
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
  ): Promise<void> {
    await consumer.run({
      eachBatchAutoResolve: false,
      eachBatch: this.handleBatchByMessage(
        cb as MessageHandlerCallback<TMessage>
      ),
    });
  }
}
