import { RetryOptions } from 'kafkajs';

export type ConsumerConfig = {
  fromBeginning?: boolean;
  heartbeatInterval?: number;
  retry?: Partial<RetryOptions>;
  allowAutoTopicCreation?: boolean;
  sessionTimeout?: number;
  rebalanceTimeout?: number;
};
