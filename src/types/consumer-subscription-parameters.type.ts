import { ConsumerOptions } from "./consumer-options.type.js";
import { MessageErrorHandlingOptions } from "./message-error-handling.type.js";
import { MessageFormat } from "./message-format.type.js";

export type ConsumerSubscriptionParameters = {
    topicPatterns: (string | RegExp)[];
    messageFormat?: MessageFormat;
    errorHandling: MessageErrorHandlingOptions;
    consumer?: ConsumerOptions;
    namespaced?: boolean;
  };
