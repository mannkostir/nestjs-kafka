export type HandlerGroup = {
  readonly handlerNames: readonly string[];
  readonly groupId: string;
};

export type FailedSubscription = HandlerGroup & {
  readonly cause: unknown;
};

export class SubscriptionFailures extends Error {
  public override readonly name = 'SubscriptionFailures';

  constructor(
    readonly failures: readonly FailedSubscription[],
    readonly aborted: readonly HandlerGroup[],
  ) {
    super(SubscriptionFailures.describe(failures, aborted));
  }

  private static describe(
    failures: readonly FailedSubscription[],
    aborted: readonly HandlerGroup[],
  ): string {
    const lines = [
      'Failed to subscribe message handlers:',
      ...failures.map(
        (failure) => `- ${SubscriptionFailures.label(failure)}: ${SubscriptionFailures.reason(failure.cause)}`,
      ),
    ];

    if (aborted.length > 0) {
      lines.push(
        `Aborted after another handler failed: ${aborted.map((subscription) => SubscriptionFailures.label(subscription)).join(', ')}`,
      );
    }

    return lines.join('\n');
  }

  private static label({ handlerNames, groupId }: HandlerGroup): string {
    return `${handlerNames.join(', ')} (groupId "${groupId}")`;
  }

  private static reason(cause: unknown): string {
    return cause instanceof Error ? cause.message : String(cause);
  }
}
