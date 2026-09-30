import type { KafkaJS } from '@confluentinc/kafka-javascript';
import { KafkaTopicProvisioner } from './kafka-topic-provisioner.js';

const ledPartitions = (topic: string) => ({ name: topic, partitions: [{ partitionId: 0, leader: 1 }] });

const adminStub = (existing: string[]) => ({
  connect: jest.fn().mockResolvedValue(undefined),
  disconnect: jest.fn().mockResolvedValue(undefined),
  listTopics: jest.fn().mockResolvedValue(existing),
  createTopics: jest.fn().mockResolvedValue(true),
  fetchTopicMetadata: jest
    .fn()
    .mockImplementation(async ({ topics }: { topics: string[] }) => topics.map(ledPartitions)),
});

const quickVisibility = { timeoutMs: 200, pollIntervalMs: 10 };

const brokerError = (message: string, code: number) => Object.assign(new Error(message), { code });
const unknownTopic = () => brokerError('Broker: Unknown topic or partition', 3);

const kafkaWith = (admin: ReturnType<typeof adminStub>) =>
  ({ admin: jest.fn().mockReturnValue(admin) }) as unknown as KafkaJS.Kafka;

describe('KafkaTopicProvisioner.createMissing', () => {
  it('creates only the topics the cluster does not have', async () => {
    const admin = adminStub(['orders.created']);

    await new KafkaTopicProvisioner(kafkaWith(admin)).createMissing([
      'orders.created',
      'payments.created',
    ]);

    expect(admin.createTopics).toHaveBeenCalledWith({
      topics: [{ topic: 'payments.created' }],
      timeout: 30000,
    });
  });

  it('does not create anything when every topic exists', async () => {
    const admin = adminStub(['orders.created']);

    await new KafkaTopicProvisioner(kafkaWith(admin)).createMissing(['orders.created']);

    expect(admin.createTopics).not.toHaveBeenCalled();
  });

  it('does not open an admin connection for an empty topic list', async () => {
    const admin = adminStub([]);
    const kafka = kafkaWith(admin);

    await new KafkaTopicProvisioner(kafka).createMissing([]);

    expect(kafka.admin).not.toHaveBeenCalled();
  });

  it('disconnects the admin when creation fails', async () => {
    const admin = adminStub([]);
    admin.createTopics.mockRejectedValue(new Error('not authorized'));

    await expect(
      new KafkaTopicProvisioner(kafkaWith(admin)).createMissing(['orders.created']),
    ).rejects.toThrow('not authorized');
    expect(admin.disconnect).toHaveBeenCalledTimes(1);
  });

  it('disconnects the admin when connect fails', async () => {
    const admin = adminStub([]);
    admin.connect.mockRejectedValue(new Error('connection refused'));

    await expect(
      new KafkaTopicProvisioner(kafkaWith(admin)).createMissing(['orders.created']),
    ).rejects.toThrow('connection refused');
    expect(admin.disconnect).toHaveBeenCalledTimes(1);
  });
});

describe('KafkaTopicProvisioner.createMissing visibility', () => {
  it('waits until a created topic is known to the broker', async () => {
    const admin = adminStub([]);
    admin.fetchTopicMetadata.mockRejectedValueOnce(unknownTopic());

    await new KafkaTopicProvisioner(kafkaWith(admin), quickVisibility).createMissing([
      'payments.created',
    ]);

    expect(admin.fetchTopicMetadata).toHaveBeenCalledTimes(2);
  });

  it('waits until every partition of a created topic has a leader', async () => {
    const admin = adminStub([]);
    admin.fetchTopicMetadata.mockResolvedValueOnce([
      { name: 'payments.created', partitions: [{ partitionId: 0, leader: -1 }] },
    ]);

    await new KafkaTopicProvisioner(kafkaWith(admin), quickVisibility).createMissing([
      'payments.created',
    ]);

    expect(admin.fetchTopicMetadata).toHaveBeenCalledTimes(2);
  });

  it('waits only for the topics it created', async () => {
    const admin = adminStub(['orders.created']);

    await new KafkaTopicProvisioner(kafkaWith(admin), quickVisibility).createMissing([
      'orders.created',
      'payments.created',
    ]);

    expect(admin.fetchTopicMetadata).toHaveBeenCalledWith(
      expect.objectContaining({ topics: ['payments.created'] }),
    );
  });

  it('does not query metadata when nothing was created', async () => {
    const admin = adminStub(['orders.created']);

    await new KafkaTopicProvisioner(kafkaWith(admin), quickVisibility).createMissing([
      'orders.created',
    ]);

    expect(admin.fetchTopicMetadata).not.toHaveBeenCalled();
  });

  it('names the topics that never became visible', async () => {
    const admin = adminStub([]);
    admin.fetchTopicMetadata.mockRejectedValue(unknownTopic());

    await expect(
      new KafkaTopicProvisioner(kafkaWith(admin), quickVisibility).createMissing([
        'payments.created',
      ]),
    ).rejects.toThrow(
      /Topic\(s\) payments\.created were created but did not become available within 200 ms/,
    );
  });

  it('keeps waiting through a metadata request that times out', async () => {
    const admin = adminStub([]);
    admin.fetchTopicMetadata.mockRejectedValueOnce(brokerError('Local: Timed out', -185));

    await expect(
      new KafkaTopicProvisioner(kafkaWith(admin), quickVisibility).createMissing([
        'payments.created',
      ]),
    ).resolves.toBeUndefined();
  });

  it('keeps waiting while the metadata omits a created topic', async () => {
    const admin = adminStub([]);
    admin.fetchTopicMetadata.mockResolvedValueOnce([]);

    await new KafkaTopicProvisioner(kafkaWith(admin), quickVisibility).createMissing([
      'payments.created',
    ]);

    expect(admin.fetchTopicMetadata).toHaveBeenCalledTimes(2);
  });

  it('surfaces a metadata error that waiting cannot fix', async () => {
    const admin = adminStub([]);
    admin.fetchTopicMetadata.mockRejectedValueOnce(
      brokerError('Broker: Topic authorization failed', 29),
    );

    await expect(
      new KafkaTopicProvisioner(kafkaWith(admin), quickVisibility).createMissing([
        'payments.created',
      ]),
    ).rejects.toThrow('Broker: Topic authorization failed');
  });

  it('disconnects the admin when a created topic never becomes visible', async () => {
    const admin = adminStub([]);
    admin.fetchTopicMetadata.mockRejectedValue(unknownTopic());
    const provisioner = new KafkaTopicProvisioner(kafkaWith(admin), quickVisibility);

    await expect(provisioner.createMissing(['payments.created'])).rejects.toThrow();

    expect(admin.disconnect).toHaveBeenCalledTimes(1);
  });
});

describe('KafkaTopicProvisioner.assertExisting', () => {
  it('names the missing topics and how to fix it', async () => {
    const admin = adminStub(['orders.created']);

    await expect(
      new KafkaTopicProvisioner(kafkaWith(admin)).assertExisting([
        'orders.created',
        'payments.created',
      ]),
    ).rejects.toThrow(
      /Topic\(s\) payments\.created do not exist and allowAutoTopicCreation is false/,
    );
  });

  it('never creates topics', async () => {
    const admin = adminStub([]);

    await new KafkaTopicProvisioner(kafkaWith(admin))
      .assertExisting(['orders.created'])
      .catch(() => undefined);

    expect(admin.createTopics).not.toHaveBeenCalled();
  });

  it('disconnects the admin after failing', async () => {
    const admin = adminStub([]);

    await new KafkaTopicProvisioner(kafkaWith(admin))
      .assertExisting(['orders.created'])
      .catch(() => undefined);

    expect(admin.disconnect).toHaveBeenCalledTimes(1);
  });
});
