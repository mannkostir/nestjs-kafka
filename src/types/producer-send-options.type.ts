import { MessageFormat } from './message-format.type.js';

export type ProducerSendOptions = {
  namespaced?: boolean;
  messageFormat?: MessageFormat;
  schemaId?: number;
  subject?: string;
};
