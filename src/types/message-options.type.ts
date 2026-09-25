import { ConsumerConfig } from "./consumer-config.type.js";
import { MessageErrorHandlingConfig } from "./message-error-handling.type.js";
import { MessageFormat } from "./message-format.type.js";

export type MessageOptions = {
    messageFormat?: MessageFormat;
    groupId: string;
    errorHandling: MessageErrorHandlingConfig;
    consumer?: ConsumerConfig;
    namespaced?: boolean;
    connectorName?: string;
  };
