import { MessageContext } from "./message-context.type.js";
import { MessageType } from "./message.type.js";

export type ReceivedMessage<TMessage extends MessageType = MessageType> = {
  message: TMessage;
  context: MessageContext;
};
