import type { KafkaJS } from '@confluentinc/kafka-javascript';
import { KafkaErrorHandleStrategy } from './kafka-error-handle.strategy.js';
import type { KafkaErrorHandleDlqStrategy } from './kafka-error-handle-dlq.strategy.js';
import type { ExponentialBackoff } from './exponential-backoff.js';
import type { HandlerRetryTopics } from './handler-retry-topics.js';
import type { PublishFailureBackoff } from './publish-failure-backoff.js';
import type { RetryDelayGate } from './retry-delay-gate.js';
import { RetryHeaders } from './retry-headers.js';
import type { RetryHop } from './retry-topic-name.js';

export class KafkaErrorHandleRetryStrategy extends KafkaErrorHandleStrategy {
  constructor(
    private readonly producer: KafkaJS.Producer,
    private readonly topics: HandlerRetryTopics,
    private readonly schedule: ExponentialBackoff,
    private readonly gate: RetryDelayGate,
    private readonly deadLetters: KafkaErrorHandleDlqStrategy,
    private readonly publishBackoff: PublishFailureBackoff,
    private readonly clock: () => number = Date.now,
  ) {
    super();
  }

  public async handle(error: unknown, payload: KafkaJS.EachBatchPayload, message: KafkaJS.KafkaMessage): Promise<void> {
    const hop = this.topics.locate(payload.batch.topic, message);
    const next = this.topics.nextTopic(hop);

    await this.publishBackoff.run(payload, message, () =>
      next === undefined
        ? this.deadLetters.publish(error, hop.source, message)
        : this.republish(next, hop, error, message),
    );

    payload.resolveOffset(message.offset);
  }

  public override destinationTopics(sourceTopics: string[]): string[] {
    return [
      ...this.topics.perSourceTopics(sourceTopics),
      ...this.topics.groupTopics(),
      ...this.deadLetters.destinationTopics(sourceTopics),
    ];
  }

  public override consumedTopics(sourceTopics: string[]): string[] {
    return this.topics.perSourceTopics(sourceTopics);
  }

  public override sharedConsumedTopics(): string[] {
    return this.topics.groupTopics();
  }

  public override isDue(payload: KafkaJS.EachBatchPayload, message: KafkaJS.KafkaMessage): boolean {
    return this.gate.isDue(payload, message);
  }

  public override holdUntilDue(payload: KafkaJS.EachBatchPayload, message: KafkaJS.KafkaMessage): boolean {
    return this.gate.holdUntilDue(payload, message);
  }

  public override stop(): void {
    this.gate.stop();
    this.publishBackoff.stop();
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
