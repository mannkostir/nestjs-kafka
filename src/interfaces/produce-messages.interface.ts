import { MessageType } from '../types/message.type';

export interface IProduceMessages<TMessage extends MessageType = MessageType> {
  send(messagePattern: string, message: TMessage): Promise<unknown>;
}
