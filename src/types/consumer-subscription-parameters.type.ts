import { MessageErrorHandlingConfig } from "./message-error-handling.type";
import { MessageFormat } from "./message-format.type";

export type ConsumerSubscriptionParameters = {
    topicPatterns: (string | RegExp)[];
    messageFormat: MessageFormat;
    errorHandling: MessageErrorHandlingConfig;
  };
