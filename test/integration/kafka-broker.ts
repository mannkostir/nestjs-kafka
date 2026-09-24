import { KafkaContainer, StartedKafkaContainer } from '@testcontainers/kafka';

const KAFKA_IMAGE = 'confluentinc/cp-kafka:7.6.1';
const KAFKA_CLIENT_PORT = 9093;

export type StartedBroker = {
  brokers: string[];
  stop(): Promise<void>;
};

export async function startBroker(): Promise<StartedBroker> {
  const container: StartedKafkaContainer = await new KafkaContainer(KAFKA_IMAGE)
    .withKraft()
    .start();

  return {
    brokers: [
      `${container.getHost()}:${container.getMappedPort(KAFKA_CLIENT_PORT)}`,
    ],
    stop: () => container.stop().then(() => undefined),
  };
}
