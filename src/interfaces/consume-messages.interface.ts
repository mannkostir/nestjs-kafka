import { MessageType } from '../types/message.type';
import { ConsumerSubscriptionParameters } from '../types/consumer-subscription-parameters.type';
import { MessageHandlerCallback } from '../types/message-handler-callback.type';

export interface IConsumeMessages<TMessage extends MessageType = MessageType> {
  subscribe(
    subscription: ConsumerSubscriptionParameters,
    cb: MessageHandlerCallback<TMessage>,
    consumerGroupId: string
  ): Promise<void>;
}
