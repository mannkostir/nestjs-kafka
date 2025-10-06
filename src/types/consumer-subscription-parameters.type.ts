import { MessageFormat } from "./message-format.type";

export type ConsumerSubscriptionParameters = {
    topicPatterns: (string | RegExp)[];
    messageFormat: MessageFormat;
  };
  