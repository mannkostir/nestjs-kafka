import type { KafkaJS } from '@confluentinc/kafka-javascript';
import type { Logger } from '@nestjs/common';

export class PausedPartitions {
  private readonly pendingResumes = new Set<NodeJS.Timeout>();
  private stopped = false;

  constructor(private readonly logger: Logger) {}

  public pauseFor(payload: KafkaJS.EachBatchPayload, delayMs: number): boolean {
    if (this.stopped) {
      return false;
    }

    const resume = this.pauseTolerantly(payload);

    if (!resume) {
      return false;
    }

    const { topic, partition } = payload.batch;
    this.scheduleResume(topic, partition, resume, delayMs);
    return true;
  }

  public stop(): void {
    this.stopped = true;
    this.pendingResumes.forEach((timer) => clearTimeout(timer));
    this.pendingResumes.clear();
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
