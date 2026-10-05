import type { KafkaJS } from '@confluentinc/kafka-javascript';
import { KafkaErrorHandleStrategy } from './kafka-error-handle.strategy.js';
import type { KafkaErrorHandleDlqStrategy } from './kafka-error-handle-dlq.strategy.js';
import type { ExponentialBackoff } from './exponential-backoff.js';
import type { RetryDelayGate } from './retry-delay-gate.js';
import { RetryHeaders } from './retry-headers.js';
import type { RetryHop, RetryTopics } from './retry-topics.js';

export class KafkaErrorHandleRetryStrategy extends KafkaErrorHandleStrategy {
  constructor(
    private readonly producer: KafkaJS.Producer,
    private readonly topics: RetryTopics,
    private readonly schedule: ExponentialBackoff,
    private readonly gate: RetryDelayGate,
    private readonly deadLetters: KafkaErrorHandleDlqStrategy,
    private readonly clock: () => number = Date.now,
  ) {
    super();
  }

  public async handle(error: unknown, payload: KafkaJS.EachBatchPayload, message: KafkaJS.KafkaMessage): Promise<void> {
    const hop = this.topics.locate(payload.batch.topic);
    const next = this.topics.nextTopic(hop);

    if (next === undefined) {
      await this.deadLetters.publish(error, hop.source, message);
    } else {
      await this.republish(next, hop, error, message);
    }

    payload.resolveOffset(message.offset);
  }

  public override destinationTopics(sourceTopics: string[]): string[] {
    return [...this.topics.allFor(sourceTopics), ...this.deadLetters.destinationTopics(sourceTopics)];
  }

  public override consumedTopics(sourceTopics: string[]): string[] {
    return this.topics.allFor(sourceTopics);
  }

  public override holdUntilDue(payload: KafkaJS.EachBatchPayload, message: KafkaJS.KafkaMessage): boolean {
    return this.gate.holdUntilDue(payload, message);
  }

  public override stop(): void {
    this.gate.stop();
  }

  private async republish(topic: string, hop: RetryHop, error: unknown, message: KafkaJS.KafkaMessage): Promise<void> {
    await this.producer.send({
      topic,
      messages: [{
        key: message.key,
        value: message.value,
        timestamp: message.timestamp,
        headers: RetryHeaders.forHop(message.headers, {
          originalTopic: hop.source,
          attempt: hop.attempt + 1,
          dueAt: this.clock() + this.schedule.delayAfter(hop.attempt),
          error,
        }),
      }],
    });
  }
}
