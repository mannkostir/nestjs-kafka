import type { KafkaJS } from '@confluentinc/kafka-javascript';
import type { Logger } from '@nestjs/common';
import type { ExponentialBackoff } from './exponential-backoff.js';
import { PausedPartitions } from './paused-partitions.js';

type PartitionFailure = { offset: string; attempt: number };

export class RedeliveryBackoff {
  private readonly failures = new Map<string, PartitionFailure>();
  private readonly partitions: PausedPartitions;

  constructor(
    private readonly backoff: ExponentialBackoff,
    private readonly logger: Logger,
  ) {
    this.partitions = new PausedPartitions(logger);
  }

  public postpone(payload: KafkaJS.EachBatchPayload, message: KafkaJS.KafkaMessage): void {
    const { topic, partition } = payload.batch;
    const attempt = this.recordFailure(topic, partition, message.offset);
    const delayMs = this.backoff.delayAfter(attempt);

    if (this.partitions.pauseFor(payload, delayMs)) {
      this.logger.warn(
        `Pausing topic "${topic}" partition ${partition} for ${delayMs} ms before redelivering offset ${message.offset}.`,
      );
    }
  }

  public stop(): void {
    this.partitions.stop();
    this.failures.clear();
  }

  private recordFailure(topic: string, partition: number, offset: string): number {
    const key = `${topic}:${partition}`;
    const previous = this.failures.get(key);
    const attempt = previous?.offset === offset ? previous.attempt + 1 : 0;
    this.failures.set(key, { offset, attempt });
    return attempt;
  }
}
