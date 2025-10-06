import { MessageErrorHandling } from "./message-error-handling.type";
import { MessageFormat } from "./message-format.type";

export type MessageOptions = {
    messageFormat: MessageFormat;
    groupId: string;
    messageErrorHandling: MessageErrorHandling;
  };