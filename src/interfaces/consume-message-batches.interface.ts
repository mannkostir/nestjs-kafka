import { BatchMessageHandlerCallback } from '../types/batch-message-handler-callback.type.js';
import { ConsumerSubscriptionParameters } from '../types/consumer-subscription-parameters.type.js';
import { MessageType } from '../types/message.type.js';

export interface IConsumeMessageBatches<TMessage extends MessageType = MessageType> {
  subscribeBatch(
    subscription: ConsumerSubscriptionParameters,
    cb: BatchMessageHandlerCallback<TMessage>,
    consumerGroupId: string,
  ): Promise<void>;
}
