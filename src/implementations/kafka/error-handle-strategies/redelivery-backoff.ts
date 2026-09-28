import type { KafkaJS } from '@confluentinc/kafka-javascript';
import type { Logger } from '@nestjs/common';
import type { ExponentialBackoff } from './exponential-backoff.js';

type PartitionFailure = { offset: string; attempt: number };

export class RedeliveryBackoff {
  private readonly failures = new Map<string, PartitionFailure>();
  private readonly pendingResumes = new Set<NodeJS.Timeout>();
  private stopped = false;

  constructor(
    private readonly backoff: ExponentialBackoff,
    private readonly logger: Logger,
  ) {}

  public postpone(payload: KafkaJS.EachBatchPayload, message: KafkaJS.KafkaMessage): void {
    if (this.stopped) {
      return;
    }

    const { topic, partition } = payload.batch;
    const attempt = this.recordFailure(topic, partition, message.offset);
    const resume = this.pauseTolerantly(payload);

    if (!resume) {
      return;
    }

    const delayMs = this.backoff.delayAfter(attempt);
    this.logger.warn(
      `Pausing topic "${topic}" partition ${partition} for ${delayMs} ms before redelivering offset ${message.offset}.`,
    );
    this.scheduleResume(topic, partition, resume, delayMs);
  }

  public stop(): void {
    this.stopped = true;
    this.pendingResumes.forEach((timer) => clearTimeout(timer));
    this.pendingResumes.clear();
    this.failures.clear();
  }

  private recordFailure(topic: string, partition: number, offset: string): number {
    const key = `${topic}:${partition}`;
    const previous = this.failures.get(key);
    const attempt = previous?.offset === offset ? previous.attempt + 1 : 0;
    this.failures.set(key, { offset, attempt });
    return attempt;
  }

  private scheduleResume(topic: string, partition: number, resume: () => void, delayMs: number): void {
    const timer = setTimeout(() => {
      this.pendingResumes.delete(timer);
      this.resumeTolerantly(topic, partition, resume);
    }, delayMs);
    timer.unref();
    this.pendingResumes.add(timer);
  }

  private pauseTolerantly(payload: KafkaJS.EachBatchPayload): (() => void) | undefined {
    try {
      return payload.pause();
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      const { topic, partition } = payload.batch;
      this.logger.warn(`Could not pause topic "${topic}" partition ${partition} for backoff: ${reason}`);
      return undefined;
    }
  }

  private resumeTolerantly(topic: string, partition: number, resume: () => void): void {
    try {
      resume();
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Could not resume topic "${topic}" partition ${partition} after backoff: ${reason}`);
    }
  }
}
