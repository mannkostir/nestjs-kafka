import { KafkaJS } from '@confluentinc/kafka-javascript';

export type TopicVisibilityPolling = {
  timeoutMs: number;
  pollIntervalMs: number;
};

const DEFAULT_VISIBILITY_POLLING: TopicVisibilityPolling = { timeoutMs: 30000, pollIntervalMs: 100 };

const NOT_YET_PROPAGATED: ReadonlySet<number> = new Set([
  KafkaJS.ErrorCodes.ERR_UNKNOWN_TOPIC_OR_PART,
  KafkaJS.ErrorCodes.ERR__UNKNOWN_TOPIC,
  KafkaJS.ErrorCodes.ERR_LEADER_NOT_AVAILABLE,
  KafkaJS.ErrorCodes.ERR__TIMED_OUT,
  KafkaJS.ErrorCodes.ERR_REQUEST_TIMED_OUT,
]);

export class KafkaTopicProvisioner {
  private static readonly CREATE_TIMEOUT_MS = 30000;

  constructor(
    private readonly kafka: KafkaJS.Kafka,
    private readonly visibility: TopicVisibilityPolling = DEFAULT_VISIBILITY_POLLING,
  ) {}

  public async createMissing(topics: string[]): Promise<void> {
    await this.withAdmin(topics, async (admin) => {
      const missing = await KafkaTopicProvisioner.findMissing(admin, topics);

      if (missing.length > 0) {
        await admin.createTopics({
          topics: missing.map((topic) => ({ topic })),
          timeout: KafkaTopicProvisioner.CREATE_TIMEOUT_MS,
        });
        await this.untilAvailable(admin, missing);
      }
    });
  }

  public async assertExisting(topics: string[]): Promise<void> {
    await this.withAdmin(topics, async (admin) => {
      const missing = await KafkaTopicProvisioner.findMissing(admin, topics);

      if (missing.length > 0) {
        throw new Error(
          `Topic(s) ${missing.join(', ')} do not exist and allowAutoTopicCreation is false. ` +
          'Create them before the application starts, or enable allowAutoTopicCreation.',
        );
      }
    });
  }

  private async withAdmin(
    topics: string[],
    work: (admin: KafkaJS.Admin) => Promise<void>,
  ): Promise<void> {
    if (topics.length === 0) {
      return;
    }

    const admin = this.kafka.admin();

    try {
      await admin.connect();
      await work(admin);
    } finally {
      await admin.disconnect();
    }
  }

  private async untilAvailable(admin: KafkaJS.Admin, topics: string[]): Promise<void> {
    const deadline = Date.now() + this.visibility.timeoutMs;

    while (!(await KafkaTopicProvisioner.allLed(admin, topics, Math.max(1, deadline - Date.now())))) {
      if (Date.now() >= deadline) {
        throw new Error(
          `Topic(s) ${topics.join(', ')} were created but did not become available within ` +
          `${this.visibility.timeoutMs} ms: the broker does not yet report a leader for every partition. ` +
          'Check the cluster\'s health, or create the topics before the application starts.',
        );
      }
      await new Promise((resolve) => setTimeout(resolve, this.visibility.pollIntervalMs));
    }
  }

  private static async allLed(
    admin: KafkaJS.Admin,
    topics: string[],
    timeout: number,
  ): Promise<boolean> {
    try {
      const metadata = await admin.fetchTopicMetadata({ topics, timeout });

      return topics.every((topic) => {
        const partitions = metadata.find(({ name }) => name === topic)?.partitions ?? [];

        return partitions.length > 0 && partitions.every(({ leader }) => leader >= 0);
      });
    } catch (error) {
      if (NOT_YET_PROPAGATED.has((error as { code?: number }).code ?? Number.NaN)) {
        return false;
      }
      throw error;
    }
  }

  private static async findMissing(admin: KafkaJS.Admin, topics: string[]): Promise<string[]> {
    const existing = new Set(await admin.listTopics());

    return topics.filter((topic) => !existing.has(topic));
  }
}
