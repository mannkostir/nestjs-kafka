import { MessageFormat } from './message-format.type.js';

export type ProducerSendOptions = {
  key?: string;
  namespaced?: boolean;
  messageFormat?: MessageFormat;
};
