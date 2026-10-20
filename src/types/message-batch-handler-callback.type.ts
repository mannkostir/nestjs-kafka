import { ReceivedMessage } from "./received-message.type.js";

export type MessageBatchHandlerCallback<TValue = unknown> = (
  batch: ReceivedMessage<TValue>[],
) => Promise<void>;
