import { ConsumerOptions } from "./consumer-options.type.js";
import { MessageErrorHandlingOptions } from "./message-error-handling.type.js";
import { MessageFormat } from "./message-format.type.js";

export type MessageOptions = {
    messageFormat?: MessageFormat;
    groupId: string;
    errorHandling: MessageErrorHandlingOptions;
    consumer?: ConsumerOptions;
    namespaced?: boolean;
    connectorName?: string;
    sharedGroup?: boolean;
  };
