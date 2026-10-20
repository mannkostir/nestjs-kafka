import { RetryHop, RetryTopicName } from './retry-topic-name.js';

export class SourceRetryTopics {
  private constructor(
    private readonly groupId: string,
    private readonly attempts: number,
  ) {}

  public static for(groupId: string, attempts: number): SourceRetryTopics {
    RetryTopicName.assertRetryable(groupId, attempts);

    return new SourceRetryTopics(groupId, attempts);
  }

  public allFor(sourceTopics: string[]): string[] {
    return sourceTopics.flatMap((source) =>
      Array.from({ length: this.attempts }, (_, index) => RetryTopicName.checked(this.name(source, index + 1))),
    );
  }

  public locate(topic: string): RetryHop | undefined {
    const marker = this.marker();
    const at = topic.lastIndexOf(marker);

    if (at <= 0) {
      return undefined;
    }

    const attempt = RetryTopicName.attemptOf(topic.slice(at + marker.length), this.attempts);

    return attempt === undefined ? undefined : { source: topic.slice(0, at), attempt };
  }

  public nextTopic(hop: RetryHop): string | undefined {
    return hop.attempt < this.attempts ? this.name(hop.source, hop.attempt + 1) : undefined;
  }

  public isRetryTopic(topic: string): boolean {
    return this.locate(topic) !== undefined;
  }

  private name(source: string, attempt: number): string {
    return `${source}${this.marker()}${attempt}`;
  }

  private marker(): string {
    return `.${this.groupId}.retry.`;
  }
}
