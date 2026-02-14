import { ConsumerConfig } from "./consumer-config.type";
import { MessageErrorHandlingConfig } from "./message-error-handling.type";
import { MessageFormat } from "./message-format.type";

export type MessageOptions = {
    /** @default MessageFormat.JSON */
    messageFormat?: MessageFormat;
    groupId: string;
    errorHandling: MessageErrorHandlingConfig;
    /** Per-handler consumer config overrides. Merged on top of module-level defaults. */
    consumer?: ConsumerConfig;
  };
