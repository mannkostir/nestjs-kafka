import { createServer } from 'node:net';
import { GenericContainer, StartedTestContainer, Wait } from 'testcontainers';

const KAFKA_IMAGE = 'confluentinc/cp-kafka:7.6.1';
const JAAS_PATH = '/tmp/jaas.conf';
const ADMIN_CONFIG_PATH = '/tmp/admin.properties';

const JAAS_CONFIG = `KafkaServer {
  org.apache.kafka.common.security.plain.PlainLoginModule required
  username="admin" password="admin" user_admin="admin" user_alice="alice";
};
`;

const ADMIN_CONFIG = `security.protocol=SASL_PLAINTEXT
sasl.mechanism=PLAIN
sasl.jaas.config=org.apache.kafka.common.security.plain.PlainLoginModule required username="admin" password="admin";
`;

export type StartedSaslBroker = {
  brokers: string[];
  createTopic(topic: string): Promise<void>;
  allowTopicRead(principal: string, topic: string): Promise<void>;
  stop(): Promise<void>;
};

const freePort = (): Promise<number> =>
  new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, () => {
      const address = server.address();
      if (address === null || typeof address === 'string') {
        server.close(() => reject(new Error('Could not determine a free port')));
        return;
      }
      server.close(() => resolve(address.port));
    });
  });

const runCli = async (container: StartedTestContainer, command: string[]): Promise<void> => {
  const result = await container.exec(command);
  if (result.exitCode !== 0) {
    throw new Error(`${command.join(' ')} failed with exit code ${result.exitCode}: ${result.output}`);
  }
};

export async function startSaslBroker(): Promise<StartedSaslBroker> {
  const port = await freePort();
  const bootstrapServer = `localhost:${port}`;

  const container = await new GenericContainer(KAFKA_IMAGE)
    .withExposedPorts({ container: port, host: port })
    .withCopyContentToContainer([
      { content: JAAS_CONFIG, target: JAAS_PATH },
      { content: ADMIN_CONFIG, target: ADMIN_CONFIG_PATH },
    ])
    .withEnvironment({
      KAFKA_OPTS: `-Djava.security.auth.login.config=${JAAS_PATH}`,
      KAFKA_NODE_ID: '1',
      KAFKA_PROCESS_ROLES: 'broker,controller',
      CLUSTER_ID: 'MkU3OEVBNTcwNTJENDM2Qk',
      KAFKA_CONTROLLER_QUORUM_VOTERS: '1@localhost:9093',
      KAFKA_LISTENERS: `SASL_PLAINTEXT://0.0.0.0:${port},CONTROLLER://0.0.0.0:9093`,
      KAFKA_ADVERTISED_LISTENERS: `SASL_PLAINTEXT://${bootstrapServer}`,
      KAFKA_LISTENER_SECURITY_PROTOCOL_MAP: 'CONTROLLER:PLAINTEXT,SASL_PLAINTEXT:SASL_PLAINTEXT',
      KAFKA_INTER_BROKER_LISTENER_NAME: 'SASL_PLAINTEXT',
      KAFKA_CONTROLLER_LISTENER_NAMES: 'CONTROLLER',
      KAFKA_SASL_ENABLED_MECHANISMS: 'PLAIN',
      KAFKA_SASL_MECHANISM_INTER_BROKER_PROTOCOL: 'PLAIN',
      KAFKA_AUTHORIZER_CLASS_NAME: 'org.apache.kafka.metadata.authorizer.StandardAuthorizer',
      KAFKA_SUPER_USERS: 'User:admin;User:ANONYMOUS',
      KAFKA_OFFSETS_TOPIC_REPLICATION_FACTOR: '1',
      KAFKA_TRANSACTION_STATE_LOG_REPLICATION_FACTOR: '1',
      KAFKA_TRANSACTION_STATE_LOG_MIN_ISR: '1',
      KAFKA_GROUP_INITIAL_REBALANCE_DELAY_MS: '0',
    })
    .withWaitStrategy(Wait.forLogMessage('Kafka Server started'))
    .start();

  return {
    brokers: [bootstrapServer],
    createTopic: (topic) =>
      runCli(container, [
        'kafka-topics',
        '--bootstrap-server',
        bootstrapServer,
        '--command-config',
        ADMIN_CONFIG_PATH,
        '--create',
        '--topic',
        topic,
        '--partitions',
        '1',
        '--replication-factor',
        '1',
      ]),
    allowTopicRead: (principal, topic) =>
      runCli(container, [
        'kafka-acls',
        '--bootstrap-server',
        bootstrapServer,
        '--command-config',
        ADMIN_CONFIG_PATH,
        '--add',
        '--allow-principal',
        principal,
        '--operation',
        'Read',
        '--operation',
        'Describe',
        '--topic',
        topic,
      ]),
    stop: () => container.stop().then(() => undefined),
  };
}
