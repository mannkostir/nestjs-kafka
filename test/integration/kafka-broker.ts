import { KafkaJS } from '@confluentinc/kafka-javascript';
import { KafkaContainer, StartedKafkaContainer } from '@testcontainers/kafka';
import { pause } from './wait.js';

const KAFKA_IMAGE = 'confluentinc/cp-kafka:7.6.1';
const KAFKA_CLIENT_PORT = 9093;
const READINESS_TIMEOUT_MS = 60000;

export type StartedBroker = {
  brokers: string[];
  stop(): Promise<void>;
};

const untilServingMetadata = async (brokers: string[]): Promise<void> => {
  const admin = new KafkaJS.Kafka({
    kafkaJS: { clientId: 'broker-readiness', brokers, logLevel: KafkaJS.logLevel.NOTHING },
  }).admin();
  const deadline = Date.now() + READINESS_TIMEOUT_MS;

  await admin.connect();

  try {
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
  } finally {
    await admin.disconnect();
  }
};

export async function startBroker(): Promise<StartedBroker> {
  const container: StartedKafkaContainer = await new KafkaContainer(KAFKA_IMAGE)
    .withKraft()
    .start();

  const brokers = [
    `${container.getHost()}:${container.getMappedPort(KAFKA_CLIENT_PORT)}`,
  ];

  await untilServingMetadata(brokers);

  return {
    brokers,
    stop: () => container.stop().then(() => undefined),
  };
}
