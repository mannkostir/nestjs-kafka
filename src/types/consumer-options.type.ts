import { ConsumerRetryOptions } from './consumer-retry-options.type.js';

export type ConsumerOptions = {
  fromBeginning?: boolean;
  heartbeatInterval?: number;
  retry?: ConsumerRetryOptions;
  createMissingTopics?: boolean;
  sessionTimeout?: number;
  rebalanceTimeout?: number;
  partitionsConsumedConcurrently?: number;
};
