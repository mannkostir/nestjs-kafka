export type RetryHop = { source: string; attempt: number };

export class RetryTopics {
  private static readonly MAX_TOPIC_LENGTH = 249;
  private static readonly TOPIC_SAFE = /^[A-Za-z0-9._-]+$/;
  private static readonly ATTEMPT = /^[1-9][0-9]*$/;

  private constructor(
    private readonly groupId: string,
    private readonly attempts: number,
  ) {}

  public static for(groupId: string, attempts: number): RetryTopics {
    if (!Number.isInteger(attempts) || attempts < 1) {
      throw new Error(`Invalid retry attempts: "attempts" (${attempts}) must be an integer greater than or equal to 1.`);
    }

    if (!RetryTopics.TOPIC_SAFE.test(groupId)) {
      throw new Error(
        `Retry error handling derives topic names from the groupId, but "${groupId}" contains characters other than ` +
        'letters, digits, ".", "_" and "-". Rename the group, or use another error handling policy.',
      );
    }

    return new RetryTopics(groupId, attempts);
  }

  public allFor(sourceTopics: string[]): string[] {
    return sourceTopics.flatMap((source) =>
      Array.from({ length: this.attempts }, (_, index) => RetryTopics.checked(this.name(source, index + 1))),
    );
  }

  public locate(topic: string): RetryHop {
    const marker = this.marker();
    const at = topic.lastIndexOf(marker);
    const suffix = at > 0 ? topic.slice(at + marker.length) : '';

    if (!RetryTopics.ATTEMPT.test(suffix) || Number(suffix) > this.attempts) {
      return { source: topic, attempt: 0 };
    }

    return { source: topic.slice(0, at), attempt: Number(suffix) };
  }

  public nextTopic(hop: RetryHop): string | undefined {
    return hop.attempt < this.attempts ? this.name(hop.source, hop.attempt + 1) : undefined;
  }

  public isRetryTopic(topic: string): boolean {
    return this.locate(topic).attempt > 0;
  }

  private name(source: string, attempt: number): string {
    return `${source}${this.marker()}${attempt}`;
  }

  private marker(): string {
    return `.${this.groupId}.retry.`;
  }

  private static checked(topic: string): string {
    if (topic.length > RetryTopics.MAX_TOPIC_LENGTH) {
      throw new Error(
        `Retry topic "${topic}" is ${topic.length} characters long, but Kafka topic names are limited to ` +
        `${RetryTopics.MAX_TOPIC_LENGTH}. Shorten the source topic or the groupId, or use another error handling policy.`,
      );
    }

    return topic;
  }
}
