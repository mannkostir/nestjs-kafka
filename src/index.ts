export { KafkaModule } from "./kafka.module";

export {
  Message,
  MessageHandlerKey,
} from "./decorators/message-handler.decorator";

export { ConsumerProxy } from "./base/consumer-proxy";
export { ProducerProxy } from "./base/producer-proxy";

export { MessageType, MessageKey, MessageValue } from "./types/message.type";
export { MessageOptions } from "./types/message-options.type";
export { MessageFormat } from "./types/message-format.type";
export { MessageErrorHandlingConfig } from "./types/message-error-handling.type";
export { ConsumerConfig } from "./types/consumer-config.type";
export { ConsumerSubscriptionParameters } from "./types/consumer-subscription-parameters.type";
export {
  KafkaModuleOptions,
  KafkaModuleAsyncOptions,
  KafkaModuleOptionsFactory,
  SchemaRegistryOptions,
} from "./types/kafka-module-options.type";
export { ProducerSendOptions } from "./types/producer-send-options.type";
