import { MessageType } from "./message.type";

export type MessageHandlerCallback<TMessage extends MessageType> = (
    message: TMessage,
    pattern: string | RegExp,
  ) => Promise<void>;