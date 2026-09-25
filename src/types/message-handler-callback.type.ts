import { MessageType } from "./message.type.js";

export type MessageHandlerCallback<TMessage extends MessageType> = (
    message: TMessage,
    pattern: string | RegExp,
  ) => Promise<void>;