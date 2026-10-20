export { KafkaModule } from "./kafka.module.js";

export { Message } from "./decorators/message-handler.decorator.js";
export { MessageBatch } from "./decorators/message-batch-handler.decorator.js";

export { ProducerProxy } from "./base/producer-proxy.js";

export { KafkaMessage, MessageKey, MessageHeaders } from "./types/message.type.js";
export { MessageOptions } from "./types/message-options.type.js";
export { MessageFormat } from "./types/message-format.type.js";
export { MessageErrorHandlingOptions, FailBackoffOptions } from "./types/message-error-handling.type.js";
export { ConsumerOptions } from "./types/consumer-options.type.js";
export { ConsumerRetryOptions } from "./types/consumer-retry-options.type.js";
export { ProducerOptions, ProducerCompression } from "./types/producer-options.type.js";
export { MessageHandlerCallback } from "./types/message-handler-callback.type.js";
export { MessageContext } from "./types/message-context.type.js";
export { ReceivedMessage } from "./types/received-message.type.js";
export { MessageBatchHandlerCallback } from "./types/message-batch-handler-callback.type.js";
export { BatchFailure } from "./errors/batch-failure.js";
export {
  KafkaModuleOptions,
  KafkaModuleAsyncOptions,
  KafkaModuleOptionsFactory,
  SchemaRegistryOptions,
} from "./types/kafka-module-options.type.js";
export { ProducerSendOptions } from "./types/producer-send-options.type.js";
export { ProducedRecord } from "./types/produced-record.type.js";
