import { IConsumeMessages } from '../interfaces/consume-messages.interface.js';
import { ConsumerSubscriptionParameters } from '../types/consumer-subscription-parameters.type.js';
import { MessageHandlerCallback } from '../types/message-handler-callback.type.js';

export abstract class ConsumerProxy<TValue = unknown>
  implements IConsumeMessages<TValue>
{
  public abstract subscribe(
    subscription: ConsumerSubscriptionParameters,
    cb: MessageHandlerCallback<TValue>,
    consumerGroupId: string
  ): Promise<void>;
}
