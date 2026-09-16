import { ConsumerConfig } from "./consumer-config.type";
import { MessageErrorHandlingConfig } from "./message-error-handling.type";
import { MessageFormat } from "./message-format.type";

export type MessageOptions = {
    messageFormat?: MessageFormat;
    groupId: string;
    errorHandling: MessageErrorHandlingConfig;
    consumer?: ConsumerConfig;
    namespaced?: boolean;
  };
