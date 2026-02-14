import { IProduceMessages } from "../interfaces/produce-messages.interface";
import { MessageType } from "../types/message.type";


export abstract class ProducerProxy<
  TPayload extends Record<string, any> = Record<string, any>,
> implements IProduceMessages<MessageType<TPayload>>
{
  public abstract send(
    messagePattern: string,
    message: MessageType<TPayload>,
  ): Promise<unknown>;
}
