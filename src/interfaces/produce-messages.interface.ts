import { KafkaMessage } from '../types/message.type.js';
import { ProducedRecord } from '../types/produced-record.type.js';
import { ProducerSendOptions } from '../types/producer-send-options.type.js';

export interface IProduceMessages {
  send<TValue>(
    topic: string,
    message: KafkaMessage<TValue>,
    options?: ProducerSendOptions,
  ): Promise<ProducedRecord[]>;
}
