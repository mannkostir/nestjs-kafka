import { KafkaJS } from '@confluentinc/kafka-javascript';
import { KafkaContainer, StartedKafkaContainer } from '@testcontainers/kafka';
import { pause } from './wait.js';

const KAFKA_IMAGE = 'confluentinc/cp-kafka:7.6.1';
const KAFKA_CLIENT_PORT = 9093;
const READINESS_TIMEOUT_MS = 60000;

export type StartedBroker = {
  brokers: string[];
  createTopics(topics: string[]): Promise<void>;
  listTopics(): Promise<string[]>;
  stop(): Promise<void>;
};

const withAdmin = async <T>(
  brokers: string[],
  work: (admin: KafkaJS.Admin) => Promise<T>,
): Promise<T> => {
  const admin = new KafkaJS.Kafka({
    kafkaJS: { clientId: 'broker-admin', brokers, logLevel: KafkaJS.logLevel.NOTHING },
  }).admin();

  await admin.connect();

  try {
    return await work(admin);
  } finally {
    await admin.disconnect();
  }
};

const untilServingMetadata = (brokers: string[]): Promise<void> =>
  withAdmin(brokers, async (admin) => {
    const deadline = Date.now() + READINESS_TIMEOUT_MS;

    while (true) {
      try {
        await admin.listTopics();
        return;
      } catch (error) {
        if (Date.now() > deadline) {
          throw error;
        }
        await pause(250);
      }
    }
  });

export const kafkaContainer = (): KafkaContainer => new KafkaContainer(KAFKA_IMAGE).withKraft();

export async function brokerOn(container: StartedKafkaContainer): Promise<StartedBroker> {
  const brokers = [
    `${container.getHost()}:${container.getMappedPort(KAFKA_CLIENT_PORT)}`,
  ];

  await untilServingMetadata(brokers);

  return {
    brokers,
    createTopics: (topics) =>
      withAdmin(brokers, async (admin) => {
        await admin.createTopics({ topics: topics.map((topic) => ({ topic })), timeout: 30000 });
      }),
    listTopics: () => withAdmin(brokers, (admin) => admin.listTopics()),
    stop: () => container.stop().then(() => undefined),
  };
}

export async function startBroker(): Promise<StartedBroker> {
  return brokerOn(await kafkaContainer().start());
}
