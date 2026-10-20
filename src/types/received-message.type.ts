import { MessageContext } from "./message-context.type.js";
import { KafkaMessage } from "./message.type.js";

export type ReceivedMessage<TValue = unknown> = {
  message: KafkaMessage<TValue>;
  context: MessageContext;
};
