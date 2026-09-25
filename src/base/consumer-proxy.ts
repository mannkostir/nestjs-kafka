import { IConsumeMessages } from '../interfaces/consume-messages.interface.js';
import { ConsumerSubscriptionParameters } from '../types/consumer-subscription-parameters.type.js';
import { MessageHandlerCallback } from '../types/message-handler-callback.type.js';
import { MessageType } from '../types/message.type.js';

export abstract class ConsumerProxy<TMessage extends MessageType = MessageType>
  implements IConsumeMessages<TMessage>
{
  public abstract subscribe(
    subscription: ConsumerSubscriptionParameters,
    cb: MessageHandlerCallback<TMessage>,
    consumerGroupId: string
  ): Promise<void>;
}
