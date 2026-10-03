import type { KafkaJS } from '@confluentinc/kafka-javascript';
import { ConsumerConfig } from '../../types/consumer-config.type.js';

export class ResolvedConsumerConfig {
  private static readonly DEFAULT_REBALANCE_TIMEOUT_MS = 300000;
  private static readonly DEFAULT_SESSION_TIMEOUT_MS = 30000;

  private constructor(
    readonly fromBeginning: boolean,
    readonly allowAutoTopicCreation: boolean,
    private readonly heartbeatInterval: number | undefined,
    private readonly sessionTimeout: number | undefined,
    private readonly rebalanceTimeout: number | undefined,
    private readonly retry: KafkaJS.RetryOptions,
  ) {}

  static resolve(handlerConfig?: ConsumerConfig, moduleDefaults?: ConsumerConfig): ResolvedConsumerConfig {
    const overrides = handlerConfig ?? {};
    const defaults = moduleDefaults ?? {};

    return new ResolvedConsumerConfig(
      overrides.fromBeginning ?? defaults.fromBeginning ?? false,
      overrides.allowAutoTopicCreation ?? defaults.allowAutoTopicCreation ?? false,
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
}
