import { IProduceMessages } from "../interfaces/produce-messages.interface.js";
import { MessageType } from "../types/message.type.js";
import { ProducerSendOptions } from "../types/producer-send-options.type.js";


export abstract class ProducerProxy<
  TPayload extends Record<string, any> = Record<string, any>,
> implements IProduceMessages<MessageType<TPayload>>
{
  public abstract send(
    topic: string,
    message: MessageType<TPayload>,
    options?: ProducerSendOptions,
  ): Promise<unknown>;
}
