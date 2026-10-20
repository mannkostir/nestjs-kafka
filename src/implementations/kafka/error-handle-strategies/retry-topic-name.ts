export type RetryHop = { source: string; attempt: number };

export class RetryTopicName {
  private static readonly MAX_TOPIC_LENGTH = 249;
  private static readonly TOPIC_SAFE = /^[A-Za-z0-9._-]+$/;
  private static readonly ATTEMPT = /^[1-9][0-9]*$/;

  public static assertRetryable(groupId: string, attempts: number): void {
    if (!Number.isInteger(attempts) || attempts < 1) {
      throw new Error(`Invalid retry attempts: "attempts" (${attempts}) must be an integer greater than or equal to 1.`);
    }

    if (!RetryTopicName.TOPIC_SAFE.test(groupId)) {
      throw new Error(
        `Retry error handling derives topic names from the groupId, but "${groupId}" contains characters other than ` +
        'letters, digits, ".", "_" and "-". Rename the group, or use another error handling policy.',
      );
    }
  }

  public static checked(topic: string): string {
    if (topic.length > RetryTopicName.MAX_TOPIC_LENGTH) {
      throw new Error(
        `Retry topic "${topic}" is ${topic.length} characters long, but Kafka topic names are limited to ` +
        `${RetryTopicName.MAX_TOPIC_LENGTH}. Shorten the source topic or the groupId, or use another error handling policy.`,
      );
    }

    return topic;
  }

  public static attemptOf(suffix: string, attempts: number): number | undefined {
    if (!RetryTopicName.ATTEMPT.test(suffix) || Number(suffix) > attempts) {
      return undefined;
    }

    return Number(suffix);
  }
}
