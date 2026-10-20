import type { KafkaJS } from '@confluentinc/kafka-javascript';
import { GroupRetryTopics } from './group-retry-topics.js';
import { RetryHop } from './retry-topic-name.js';
import { SourceRetryTopics } from './source-retry-topics.js';

export class HandlerRetryTopics {
  constructor(
    private readonly perSource: SourceRetryTopics,
    private readonly concreteSources: ReadonlySet<string>,
    private readonly group?: GroupRetryTopics,
  ) {}

  public locate(topic: string, message: KafkaJS.KafkaMessage): RetryHop {
    return this.group?.locate(topic, message) ?? this.perSource.locate(topic) ?? { source: topic, attempt: 0 };
  }

  public nextTopic(hop: RetryHop): string | undefined {
    return this.schemeFor(hop.source).nextTopic(hop);
  }

  public isRetryTopic(topic: string): boolean {
    return this.perSource.isRetryTopic(topic) || (this.group?.isRetryTopic(topic) ?? false);
  }

  public perSourceTopics(sources: string[]): string[] {
    return this.perSource.allFor(sources);
  }

  public groupTopics(): string[] {
    return this.group?.all() ?? [];
  }

  private schemeFor(source: string): SourceRetryTopics | GroupRetryTopics {
    return this.group && !this.concreteSources.has(source) ? this.group : this.perSource;
  }
}
