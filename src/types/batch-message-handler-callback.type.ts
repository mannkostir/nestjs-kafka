import { MessageType } from "./message.type.js";
import { ReceivedMessage } from "./received-message.type.js";

export type BatchMessageHandlerCallback<TMessage extends MessageType> = (
  batch: ReceivedMessage<TMessage>[],
) => Promise<void>;
