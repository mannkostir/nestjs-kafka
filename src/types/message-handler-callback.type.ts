import { MessageContext } from "./message-context.type.js";
import { MessageType } from "./message.type.js";

export type MessageHandlerCallback<TMessage extends MessageType> = (
    message: TMessage,
    context: MessageContext,
  ) => Promise<void>;