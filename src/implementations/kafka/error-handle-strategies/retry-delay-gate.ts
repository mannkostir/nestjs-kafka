import type { KafkaJS } from '@confluentinc/kafka-javascript';
import { PausedPartitions } from './paused-partitions.js';
import { RetryHeaders } from './retry-headers.js';
import { RetryTopics } from './retry-topics.js';

export class RetryDelayGate {
  private static readonly LONGEST_TIMER_DELAY_MS = 2147483647;

  constructor(
    private readonly topics: RetryTopics,
    private readonly partitions: PausedPartitions,
    private readonly clock: () => number = Date.now,
  ) {}

  public holdUntilDue(payload: KafkaJS.EachBatchPayload, message: KafkaJS.KafkaMessage): boolean {
    if (!this.topics.isRetryTopic(payload.batch.topic)) {
      return false;
    }

    const waitMs = RetryHeaders.dueAt(message) - this.clock();

    if (!(waitMs > 0)) {
      return false;
    }

    return this.partitions.pauseFor(payload, Math.min(waitMs, RetryDelayGate.LONGEST_TIMER_DELAY_MS));
  }

  public stop(): void {
    this.partitions.stop();
  }
}
