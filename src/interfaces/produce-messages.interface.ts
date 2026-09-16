import { MessageType } from '../types/message.type';
import { ProducerSendOptions } from '../types/producer-send-options.type';

export interface IProduceMessages<TMessage extends MessageType = MessageType> {
  send(
    topic: string,
    message: TMessage,
    options?: ProducerSendOptions,
  ): Promise<unknown>;
}
