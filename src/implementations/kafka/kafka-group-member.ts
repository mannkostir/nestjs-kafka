import { KafkaJS } from '@confluentinc/kafka-javascript';
import type { RdKafka } from '@confluentinc/kafka-javascript';
import { Logger } from '@nestjs/common';

type RebalanceEvent = { code: number };

export class KafkaGroupMember {
  private readonly logger = new Logger(KafkaGroupMember.name);

  private markAssigned: () => void = () => undefined;

  private readonly firstAssignment = new Promise<void>((resolve) => {
    this.markAssigned = resolve;
  });

  private readonly groupId: string;

  private readonly onRebalance = async (
    event: RebalanceEvent,
    assignment: KafkaJS.TopicPartition[],
  ): Promise<RdKafka.TopicPartitionOffset[] | undefined> => {
    if (event.code !== KafkaJS.ErrorCodes.ERR__ASSIGN_PARTITIONS) {
      return undefined;
    }

    try {
      if (!this.startAtLogEnd || assignment.length === 0) {
        return undefined;
      }

      return await this.pinnedToStartOffsets(assignment);
    } catch (error) {
      this.logger.warn(
        `Consumer group "${this.groupId}" failed to pin start offsets for its new assignment; ` +
          `falling back to the client's default start offsets. ${(error as Error).message}`,
      );
      return undefined;
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
    this.groupId = config.groupId;
    this.consumer = kafka.consumer({ rebalance_cb: this.onRebalance, kafkaJS: config });
  }

  public async joined(timeoutMs: number): Promise<void> {
    let timer: NodeJS.Timeout | undefined;

    const expiry = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () =>
          reject(
            new Error(
              `Consumer group "${this.groupId}" received no partition assignment within ${timeoutMs} ms. ` +
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
    const admin = this.consumer.dependentAdmin();

    try {
      await admin.connect();

      const committed = await this.committedOffsets(admin, assignment);
      const logEnds = await KafkaGroupMember.logEndOffsets(
        admin,
        assignment.filter(
          ({ topic, partition }) =>
            !KafkaGroupMember.isValidOffset(committed.get(`${topic}:${partition}`)),
        ),
      );

      return assignment.map(({ topic, partition }) => ({
        topic,
        partition,
        offset: KafkaGroupMember.startOffset(committed, logEnds, topic, partition),
      }));
    } finally {
      await admin.disconnect();
    }
  }

  private async committedOffsets(
    admin: KafkaJS.Admin,
    assignment: KafkaJS.TopicPartition[],
  ): Promise<Map<string, string>> {
    const results = await admin.fetchOffsets({
      groupId: this.groupId,
      topics: KafkaGroupMember.byTopic(assignment),
    });

    return new Map(
      results.flatMap(({ topic, partitions }) =>
        partitions.map(({ partition, offset }) => [`${topic}:${partition}`, offset] as const),
      ),
    );
  }

  private static async logEndOffsets(
    admin: KafkaJS.Admin,
    partitions: KafkaJS.TopicPartition[],
  ): Promise<Map<string, string>> {
    if (partitions.length === 0) {
      return new Map();
    }

    const topics = [...new Set(partitions.map(({ topic }) => topic))];
    const offsets = await Promise.all(
      topics.map(async (topic) =>
        (await admin.fetchTopicOffsets(topic)).map(
          ({ partition, high }) => [`${topic}:${partition}`, high] as const,
        ),
      ),
    );

    return new Map(offsets.flat());
  }

  private static byTopic(
    assignment: KafkaJS.TopicPartition[],
  ): { topic: string; partitions: number[] }[] {
    const partitionsByTopic = new Map<string, number[]>();

    for (const { topic, partition } of assignment) {
      const partitions = partitionsByTopic.get(topic) ?? [];
      partitions.push(partition);
      partitionsByTopic.set(topic, partitions);
    }

    return [...partitionsByTopic.entries()].map(([topic, partitions]) => ({ topic, partitions }));
  }

  private static startOffset(
    committed: Map<string, string>,
    logEnds: Map<string, string>,
    topic: string,
    partition: number,
  ): number {
    const key = `${topic}:${partition}`;
    const offset = committed.get(key);

    if (KafkaGroupMember.isValidOffset(offset)) {
      return Number(offset);
    }

    const logEnd = logEnds.get(key);
    if (logEnd === undefined) {
      throw new Error(`No log end offset was returned for ${key}.`);
    }

    return Number(logEnd);
  }

  private static isValidOffset(offset: string | undefined): offset is string {
    return offset !== undefined && Number(offset) >= 0;
  }
}
