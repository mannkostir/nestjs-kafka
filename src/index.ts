export { KafkaModule } from "./kafka.module.js";

export { Message } from "./decorators/message-handler.decorator.js";

export { ConsumerProxy } from "./base/consumer-proxy.js";
export { ProducerProxy } from "./base/producer-proxy.js";

export { MessageType, MessageKey, MessageValue } from "./types/message.type.js";
export { MessageOptions } from "./types/message-options.type.js";
export { MessageFormat } from "./types/message-format.type.js";
export { MessageErrorHandlingConfig } from "./types/message-error-handling.type.js";
export { ConsumerConfig } from "./types/consumer-config.type.js";
export { ConsumerSubscriptionParameters } from "./types/consumer-subscription-parameters.type.js";
export { MessageHandlerCallback } from "./types/message-handler-callback.type.js";
export {
  KafkaModuleOptions,
  KafkaModuleAsyncOptions,
  KafkaModuleOptionsFactory,
  SchemaRegistryOptions,
} from "./types/kafka-module-options.type.js";
export { ProducerSendOptions } from "./types/producer-send-options.type.js";
