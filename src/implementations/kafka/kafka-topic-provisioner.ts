import type { KafkaJS } from '@confluentinc/kafka-javascript';

export class KafkaTopicProvisioner {
  private static readonly CREATE_TIMEOUT_MS = 30000;

  constructor(private readonly kafka: KafkaJS.Kafka) {}

  public async createMissing(topics: string[]): Promise<void> {
    await this.withAdmin(topics, async (admin) => {
      const missing = await KafkaTopicProvisioner.findMissing(admin, topics);

      if (missing.length > 0) {
        await admin.createTopics({
          topics: missing.map((topic) => ({ topic })),
          timeout: KafkaTopicProvisioner.CREATE_TIMEOUT_MS,
        });
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

  private static async findMissing(admin: KafkaJS.Admin, topics: string[]): Promise<string[]> {
    const existing = new Set(await admin.listTopics());

    return topics.filter((topic) => !existing.has(topic));
  }
}
