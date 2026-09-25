import { MessageType } from '../types/message.type.js';
import { ProducerSendOptions } from '../types/producer-send-options.type.js';

export interface IProduceMessages<TMessage extends MessageType = MessageType> {
  send(
    topic: string,
    message: TMessage,
    options?: ProducerSendOptions,
  ): Promise<unknown>;
}
