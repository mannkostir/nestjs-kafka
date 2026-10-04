import { GenericContainer, Network, Wait } from 'testcontainers';
import { SchemaRegistry } from '@kafkajs/confluent-schema-registry';
import { brokerOn, kafkaContainer, StartedBroker } from './kafka-broker.js';

const SCHEMA_REGISTRY_IMAGE = 'confluentinc/cp-schema-registry:7.6.1';
const SCHEMA_REGISTRY_PORT = 8081;
const KAFKA_ALIAS = 'kafka';
const KAFKA_INTERNAL_LISTENER = `PLAINTEXT://${KAFKA_ALIAS}:9092`;
const REGISTRY_STARTUP_TIMEOUT_MS = 120000;

export type StartedSchemaRegistryBroker = Omit<StartedBroker, 'stop'> & {
  registryUrl: string;
  registry: SchemaRegistry;
  stop(): Promise<void>;
};

export async function startSchemaRegistryBroker(): Promise<StartedSchemaRegistryBroker> {
  const network = await new Network().start();

  const kafka = await kafkaContainer()
    .withNetwork(network)
    .withNetworkAliases(KAFKA_ALIAS)
    .start();

  const broker = await brokerOn(kafka);

  const registryContainer = await new GenericContainer(SCHEMA_REGISTRY_IMAGE)
    .withNetwork(network)
    .withExposedPorts(SCHEMA_REGISTRY_PORT)
    .withEnvironment({
      SCHEMA_REGISTRY_HOST_NAME: 'schema-registry',
      SCHEMA_REGISTRY_LISTENERS: `http://0.0.0.0:${SCHEMA_REGISTRY_PORT}`,
      SCHEMA_REGISTRY_KAFKASTORE_BOOTSTRAP_SERVERS: KAFKA_INTERNAL_LISTENER,
    })
    .withWaitStrategy(Wait.forHttp('/subjects', SCHEMA_REGISTRY_PORT).forStatusCode(200))
    .withStartupTimeout(REGISTRY_STARTUP_TIMEOUT_MS)
    .start();

  const registryUrl = `http://${registryContainer.getHost()}:${registryContainer.getMappedPort(SCHEMA_REGISTRY_PORT)}`;

  return {
    brokers: broker.brokers,
    createTopics: broker.createTopics,
    listTopics: broker.listTopics,
    registryUrl,
    registry: new SchemaRegistry({ host: registryUrl }),
    stop: async () => {
      await registryContainer.stop();
      await broker.stop();
      await network.stop();
    },
  };
}
