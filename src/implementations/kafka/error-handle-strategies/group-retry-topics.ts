import type { KafkaJS } from '@confluentinc/kafka-javascript';
import { RetryHeaders } from './retry-headers.js';
import { RetryHop, RetryTopicName } from './retry-topic-name.js';

export class GroupRetryTopics {
  private constructor(
    private readonly groupId: string,
    private readonly attempts: number,
  ) {}

  public static for(groupId: string, attempts: number): GroupRetryTopics {
    RetryTopicName.assertRetryable(groupId, attempts);

    return new GroupRetryTopics(groupId, attempts);
  }

  public all(): string[] {
    return Array.from({ length: this.attempts }, (_, index) => RetryTopicName.checked(this.name(index + 1)));
  }

  public locate(topic: string, message: KafkaJS.KafkaMessage): RetryHop | undefined {
    const attempt = this.attemptOf(topic);

    return attempt === undefined ? undefined : { source: RetryHeaders.originalTopic(message) ?? topic, attempt };
  }

  public nextTopic(hop: RetryHop): string | undefined {
    return hop.attempt < this.attempts ? this.name(hop.attempt + 1) : undefined;
  }

  public isRetryTopic(topic: string): boolean {
    return this.attemptOf(topic) !== undefined;
  }

  private attemptOf(topic: string): number | undefined {
    const prefix = this.prefix();

    return topic.startsWith(prefix) ? RetryTopicName.attemptOf(topic.slice(prefix.length), this.attempts) : undefined;
  }

  private name(attempt: number): string {
    return `${this.prefix()}${attempt}`;
  }

  private prefix(): string {
    return `${this.groupId}.retry.`;
  }
}
