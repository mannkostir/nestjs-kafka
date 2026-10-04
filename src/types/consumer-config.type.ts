import type { KafkaJS } from '@confluentinc/kafka-javascript';

export type ConsumerConfig = {
  fromBeginning?: boolean;
  heartbeatInterval?: number;
  retry?: KafkaJS.RetryOptions;
  allowAutoTopicCreation?: boolean;
  sessionTimeout?: number;
  rebalanceTimeout?: number;
  partitionsConsumedConcurrently?: number;
};
