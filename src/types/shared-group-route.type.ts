import { BatchMessageHandlerCallback } from "./batch-message-handler-callback.type.js";
import { ConsumerSubscriptionParameters } from "./consumer-subscription-parameters.type.js";
import { MessageHandlerCallback } from "./message-handler-callback.type.js";
import { MessageType } from "./message.type.js";

export type RouteDelivery<TMessage extends MessageType = MessageType> =
  | { kind: 'message'; handle: MessageHandlerCallback<TMessage> }
  | { kind: 'batch'; handle: BatchMessageHandlerCallback<TMessage> };

export type SharedGroupRoute<TMessage extends MessageType = MessageType> = {
  handlerName: string;
  subscription: ConsumerSubscriptionParameters;
  delivery: RouteDelivery<TMessage>;
};
