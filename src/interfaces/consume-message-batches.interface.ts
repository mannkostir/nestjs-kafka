import { MessageBatchHandlerCallback } from '../types/message-batch-handler-callback.type.js';
import { ConsumerSubscriptionParameters } from '../types/consumer-subscription-parameters.type.js';

export interface IConsumeMessageBatches<TValue = unknown> {
  subscribeBatch(
    subscription: ConsumerSubscriptionParameters,
    cb: MessageBatchHandlerCallback<TValue>,
    consumerGroupId: string,
  ): Promise<void>;
}
