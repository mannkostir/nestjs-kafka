import { KafkaJS } from '@confluentinc/kafka-javascript';
import type { RdKafka } from '@confluentinc/kafka-javascript';

type RebalanceEvent = { code: number };

export class KafkaGroupMember {
  private markAssigned: () => void = () => undefined;

  private readonly firstAssignment = new Promise<void>((resolve) => {
    this.markAssigned = resolve;
  });

  private readonly onRebalance = async (
    event: RebalanceEvent,
    assignment: KafkaJS.TopicPartition[],
  ): Promise<RdKafka.TopicPartitionOffset[] | undefined> => {
    if (event.code !== KafkaJS.ErrorCodes.ERR__ASSIGN_PARTITIONS) {
      return undefined;
    }

    try {
      return this.startAtLogEnd && assignment.length > 0
        ? await this.pinnedToStartOffsets(assignment)
        : undefined;
    } finally {
      this.markAssigned();
    }
  };

  public readonly consumer: KafkaJS.Consumer;

  constructor(
    kafka: KafkaJS.Kafka,
    config: KafkaJS.ConsumerConfig,
    private readonly startAtLogEnd: boolean,
  ) {
    this.consumer = kafka.consumer({ rebalance_cb: this.onRebalance, kafkaJS: config });
  }

  public async joined(groupId: string, timeoutMs: number): Promise<void> {
    let timer: NodeJS.Timeout | undefined;

    const expiry = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () =>
          reject(
            new Error(
              `Consumer group "${groupId}" received no partition assignment within ${timeoutMs} ms. ` +
                'Check that the brokers are reachable and that this client may join the group, ' +
                'or raise rebalanceTimeout / sessionTimeout if the group rebalances slowly.',
            ),
          ),
        timeoutMs,
      );
    });

    try {
      await Promise.race([this.firstAssignment, expiry]);
    } finally {
      clearTimeout(timer);
    }
  }

  private async pinnedToStartOffsets(
    assignment: KafkaJS.TopicPartition[],
  ): Promise<RdKafka.TopicPartitionOffset[]> {
    const committed = await this.consumer.committed(assignment);
    const logEnds = await this.logEndOffsets(
      committed.filter(({ offset }) => !KafkaGroupMember.isValidOffset(offset)),
    );

    return committed.map(({ topic, partition, offset }) => ({
      topic,
      partition,
      offset: KafkaGroupMember.isValidOffset(offset)
        ? Number(offset)
        : Number(logEnds.get(`${topic}:${partition}`)),
    }));
  }

  private async logEndOffsets(
    partitions: KafkaJS.TopicPartition[],
  ): Promise<Map<string, string>> {
    if (partitions.length === 0) {
      return new Map();
    }

    const admin = this.consumer.dependentAdmin();
    await admin.connect();

    try {
      const topics = [...new Set(partitions.map(({ topic }) => topic))];
      const offsets = await Promise.all(
        topics.map(async (topic) =>
          (await admin.fetchTopicOffsets(topic)).map(
            ({ partition, high }) => [`${topic}:${partition}`, high] as const,
          ),
        ),
      );

      return new Map(offsets.flat());
    } finally {
      await admin.disconnect();
    }
  }

  private static isValidOffset(offset: string | null): offset is string {
    return offset !== null && Number(offset) >= 0;
  }
}
