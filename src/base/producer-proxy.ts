import { IProduceMessages } from "../interfaces/produce-messages.interface.js";
import { MessageType } from "../types/message.type.js";
import { ProducerSendOptions } from "../types/producer-send-options.type.js";


export abstract class ProducerProxy<TValue = unknown>
  implements IProduceMessages<MessageType<TValue>>
{
  public abstract send(
    topic: string,
    message: MessageType<TValue>,
    options?: ProducerSendOptions,
  ): Promise<unknown>;
}
