import { MessageType } from '../types/message.type.js';
import { ProducedRecord } from '../types/produced-record.type.js';
import { ProducerSendOptions } from '../types/producer-send-options.type.js';

export interface IProduceMessages {
  send<TValue>(
    topic: string,
    message: MessageType<TValue>,
    options?: ProducerSendOptions,
  ): Promise<ProducedRecord[]>;
}
