import type { KafkaJS } from '@confluentinc/kafka-javascript';
import { ConsumerConfig } from '../../types/consumer-config.type.js';

type SharedGroupMember = { handlerName: string; config: ResolvedConsumerConfig };

type OptionDifference = { option: string; value: unknown; otherValue: unknown };

export class ResolvedConsumerConfig {
  private static readonly DEFAULT_REBALANCE_TIMEOUT_MS = 300000;
  private static readonly DEFAULT_SESSION_TIMEOUT_MS = 30000;

  private constructor(
    readonly fromBeginning: boolean,
    readonly allowAutoTopicCreation: boolean,
    readonly partitionsConsumedConcurrently: number,
    private readonly heartbeatInterval: number | undefined,
    private readonly sessionTimeout: number | undefined,
    private readonly rebalanceTimeout: number | undefined,
    private readonly retry: KafkaJS.RetryOptions,
  ) {}

  static resolve(handlerConfig?: ConsumerConfig, moduleDefaults?: ConsumerConfig): ResolvedConsumerConfig {
    const overrides = handlerConfig ?? {};
    const defaults = moduleDefaults ?? {};
    const partitionsConsumedConcurrently =
      overrides.partitionsConsumedConcurrently ?? defaults.partitionsConsumedConcurrently ?? 1;

    if (!Number.isInteger(partitionsConsumedConcurrently) || partitionsConsumedConcurrently < 1) {
      throw new Error(
        `partitionsConsumedConcurrently must be a positive integer, got ${partitionsConsumedConcurrently}. Set it to 1 or more, or leave it unset to consume one partition at a time.`,
      );
    }

    return new ResolvedConsumerConfig(
      overrides.fromBeginning ?? defaults.fromBeginning ?? false,
      overrides.allowAutoTopicCreation ?? defaults.allowAutoTopicCreation ?? false,
      partitionsConsumedConcurrently,
      overrides.heartbeatInterval ?? defaults.heartbeatInterval,
      overrides.sessionTimeout ?? defaults.sessionTimeout,
      overrides.rebalanceTimeout ?? defaults.rebalanceTimeout,
      { ...defaults.retry, ...overrides.retry },
    );
  }

  clientConfig(groupId: string): KafkaJS.ConsumerConfig {
    return ResolvedConsumerConfig.withoutUndefined({
      groupId,
      fromBeginning: this.fromBeginning,
      allowAutoTopicCreation: this.allowAutoTopicCreation,
      heartbeatInterval: this.heartbeatInterval,
      sessionTimeout: this.sessionTimeout,
      rebalanceTimeout: this.rebalanceTimeout,
      retry: this.retry,
    });
  }

  joinTimeoutMs(): number {
    return (this.rebalanceTimeout ?? ResolvedConsumerConfig.DEFAULT_REBALANCE_TIMEOUT_MS) +
      (this.sessionTimeout ?? ResolvedConsumerConfig.DEFAULT_SESSION_TIMEOUT_MS);
  }

  private static withoutUndefined<T extends object>(config: T): T {
    return Object.fromEntries(
      Object.entries(config).filter(([, value]) => value !== undefined),
    ) as T;
  }

  static agreed(groupId: string, members: readonly SharedGroupMember[]): ResolvedConsumerConfig {
    const [first, ...rest] = members;

    for (const member of rest) {
      const difference = first.config.differenceFrom(member.config);

      if (difference) {
        throw new Error(
          `Message handlers ${first.handlerName} and ${member.handlerName} share group "${groupId}" but resolve consumer option "${difference.option}" differently (${ResolvedConsumerConfig.describe(difference.value)} vs ${ResolvedConsumerConfig.describe(difference.otherValue)}). Give every handler in a shared group the same consumer options, or set them in consumerDefaults.`,
        );
      }
    }

    return first.config;
  }

  private differenceFrom(other: ResolvedConsumerConfig): OptionDifference | undefined {
    const theirs = other.options();

    return Object.entries(this.options())
      .map(([option, value]) => ({ option, value, otherValue: theirs[option] }))
      .find(({ value, otherValue }) => !ResolvedConsumerConfig.sameValue(value, otherValue));
  }

  private options(): Record<string, unknown> {
    return {
      fromBeginning: this.fromBeginning,
      allowAutoTopicCreation: this.allowAutoTopicCreation,
      partitionsConsumedConcurrently: this.partitionsConsumedConcurrently,
      heartbeatInterval: this.heartbeatInterval,
      sessionTimeout: this.sessionTimeout,
      rebalanceTimeout: this.rebalanceTimeout,
      retry: this.retry,
    };
  }

  private static sameValue(value: unknown, otherValue: unknown): boolean {
    return ResolvedConsumerConfig.canonical(value) === ResolvedConsumerConfig.canonical(otherValue);
  }

  private static canonical(value: unknown): string | undefined {
    if (typeof value === 'object' && value !== null) {
      return JSON.stringify(
        Object.entries(value)
          .filter(([, entry]) => entry !== undefined)
          .sort(([left], [right]) => left.localeCompare(right)),
      );
    }

    return JSON.stringify(value);
  }

  private static describe(value: unknown): string {
    return value === undefined ? 'unset' : JSON.stringify(value);
  }
}
