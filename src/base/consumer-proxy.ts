import { IConsumeMessages } from '../interfaces/consume-messages.interface';
import { ConsumerSubscriptionParameters } from '../types/consumer-subscription-parameters.type';
import { MessageHandlerCallback } from '../types/message-handler-callback.type';
import { MessageType } from '../types/message.type';

export abstract class ConsumerProxy<TMessage extends MessageType = MessageType>
  implements IConsumeMessages<TMessage>
{
  public abstract subscribe(
    subscription: ConsumerSubscriptionParameters,
    cb: MessageHandlerCallback<TMessage>,
    consumerGroupId: string
  ): Promise<void>;
}
