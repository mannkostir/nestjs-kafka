import { RetryOptions } from 'kafkajs';

export type ConsumerConfig = {
  /** Whether to consume from the beginning of the topic. @default false */
  fromBeginning?: boolean;
  /** Heartbeat interval in ms. @default 30000 */
  heartbeatInterval?: number;
  /** Retry configuration for the consumer. */
  retry?: Partial<RetryOptions>;
  /** Allow auto topic creation. @default true */
  allowAutoTopicCreation?: boolean;
  /** Session timeout in ms (kafkajs default: 30000). */
  sessionTimeout?: number;
  /** Rebalance timeout in ms (kafkajs default: 60000). */
  rebalanceTimeout?: number;
};
