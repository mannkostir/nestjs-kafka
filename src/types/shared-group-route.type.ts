import { MessageBatchHandlerCallback } from "./message-batch-handler-callback.type.js";
import { ConsumerSubscriptionParameters } from "./consumer-subscription-parameters.type.js";
import { MessageHandlerCallback } from "./message-handler-callback.type.js";

export type RouteDelivery<TValue = unknown> =
  | { kind: 'message'; handle: MessageHandlerCallback<TValue> }
  | { kind: 'batch'; handle: MessageBatchHandlerCallback<TValue> };

export type SharedGroupRoute<TValue = unknown> = {
  handlerName: string;
  subscription: ConsumerSubscriptionParameters;
  delivery: RouteDelivery<TValue>;
};
