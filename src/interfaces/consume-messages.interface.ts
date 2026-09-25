import { MessageType } from '../types/message.type.js';
import { ConsumerSubscriptionParameters } from '../types/consumer-subscription-parameters.type.js';
import { MessageHandlerCallback } from '../types/message-handler-callback.type.js';

export interface IConsumeMessages<TMessage extends MessageType = MessageType> {
  subscribe(
    subscription: ConsumerSubscriptionParameters,
    cb: MessageHandlerCallback<TMessage>,
    consumerGroupId: string
  ): Promise<void>;
}
