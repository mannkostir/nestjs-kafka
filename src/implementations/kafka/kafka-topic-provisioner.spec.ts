import type { KafkaJS } from '@confluentinc/kafka-javascript';
import { KafkaTopicProvisioner } from './kafka-topic-provisioner.js';

const adminStub = (existing: string[]) => ({
  connect: jest.fn().mockResolvedValue(undefined),
  disconnect: jest.fn().mockResolvedValue(undefined),
  listTopics: jest.fn().mockResolvedValue(existing),
  createTopics: jest.fn().mockResolvedValue(true),
});

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
