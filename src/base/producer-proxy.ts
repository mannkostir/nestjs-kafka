import { IProduceMessages } from "../interfaces/produce-messages.interface.js";
import { KafkaMessage } from "../types/message.type.js";
import { ProducedRecord } from "../types/produced-record.type.js";
import { ProducerSendOptions } from "../types/producer-send-options.type.js";


export abstract class ProducerProxy implements IProduceMessages {
  public abstract send<TValue>(
    topic: string,
    message: KafkaMessage<TValue>,
    options?: ProducerSendOptions,
  ): Promise<ProducedRecord[]>;
}
