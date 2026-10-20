import { ConsumerSubscriptionParameters } from '../types/consumer-subscription-parameters.type.js';
import { MessageHandlerCallback } from '../types/message-handler-callback.type.js';

export interface IConsumeMessages<TValue = unknown> {
  subscribe(
    subscription: ConsumerSubscriptionParameters,
    cb: MessageHandlerCallback<TValue>,
    consumerGroupId: string
  ): Promise<void>;
}
