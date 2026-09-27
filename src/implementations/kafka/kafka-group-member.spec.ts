import type { KafkaJS } from '@confluentinc/kafka-javascript';
import { KafkaGroupMember } from './kafka-group-member.js';

const adminStub = () => ({
  connect: jest.fn().mockResolvedValue(undefined),
  disconnect: jest.fn().mockResolvedValue(undefined),
  fetchTopicOffsets: jest.fn().mockResolvedValue([]),
});

const consumerStub = (admin: ReturnType<typeof adminStub>) => ({
  committed: jest.fn().mockResolvedValue([]),
  dependentAdmin: jest.fn().mockReturnValue(admin),
});

const kafkaStub = (consumer: ReturnType<typeof consumerStub>) =>
  ({
    consumer: jest.fn().mockReturnValue(consumer),
  }) as unknown as KafkaJS.Kafka;

const config = (): KafkaJS.ConsumerConfig => ({ groupId: 'g' });

const rebalanceCallback = (kafka: KafkaJS.Kafka) =>
  (kafka.consumer as jest.Mock).mock.calls.at(-1)[0].rebalance_cb as (
    event: { code: number },
    assignment: KafkaJS.TopicPartition[],
  ) => Promise<unknown>;

describe('KafkaGroupMember construction', () => {
  it('installs the rebalance callback outside the kafkaJS block', () => {
    const kafka = kafkaStub(consumerStub(adminStub()));
    const passedConfig = config();

    new KafkaGroupMember(kafka, passedConfig, false);

    const call = (kafka.consumer as jest.Mock).mock.calls[0][0];
    expect(typeof call.rebalance_cb).toBe('function');
    expect(call.kafkaJS).toEqual(passedConfig);
  });
});

describe('KafkaGroupMember.joined', () => {
  it('resolves joined on the first assignment', async () => {
    const kafka = kafkaStub(consumerStub(adminStub()));
    const member = new KafkaGroupMember(kafka, config(), false);

    await rebalanceCallback(kafka)({ code: -175 }, [{ topic: 't', partition: 0 }]);

    await expect(member.joined('g', 1000)).resolves.toBeUndefined();
  });

  it('resolves joined on an empty first assignment', async () => {
    const kafka = kafkaStub(consumerStub(adminStub()));
    const member = new KafkaGroupMember(kafka, config(), false);

    await rebalanceCallback(kafka)({ code: -175 }, []);

    await expect(member.joined('g', 1000)).resolves.toBeUndefined();
  });

  it('ignores a revocation', async () => {
    jest.useFakeTimers();
    const kafka = kafkaStub(consumerStub(adminStub()));
    const member = new KafkaGroupMember(kafka, config(), false);

    await rebalanceCallback(kafka)({ code: -174 }, [{ topic: 't', partition: 0 }]);

    const assertion = expect(member.joined('g', 1000)).rejects.toThrow(
      /Consumer group "g" received no partition assignment within 1000 ms/,
    );
    jest.advanceTimersByTime(1000);
    await assertion;
    jest.useRealTimers();
  });

  it('rejects naming the group when no assignment arrives in time', async () => {
    jest.useFakeTimers();
    const kafka = kafkaStub(consumerStub(adminStub()));
    const member = new KafkaGroupMember(kafka, config(), false);

    const assertion = expect(member.joined('g', 1000)).rejects.toThrow(
      /Consumer group "g" received no partition assignment within 1000 ms/,
    );
    jest.advanceTimersByTime(1000);
    await assertion;
    jest.useRealTimers();
  });
});

describe('KafkaGroupMember start offset pinning', () => {
  it('starts an uncommitted partition at the log end when startAtLogEnd', async () => {
    const admin = adminStub();
    admin.fetchTopicOffsets.mockResolvedValue([
      { partition: 0, high: '42', low: '0', offset: '42' },
    ]);
    const consumer = consumerStub(admin);
    consumer.committed.mockResolvedValue([{ topic: 't', partition: 0, offset: null }]);
    const kafka = kafkaStub(consumer);
    const member = new KafkaGroupMember(kafka, config(), true);

    const result = await rebalanceCallback(kafka)({ code: -175 }, [{ topic: 't', partition: 0 }]);

    expect(result).toEqual([{ topic: 't', partition: 0, offset: 42 }]);
    expect(typeof (result as { offset: number }[])[0].offset).toBe('number');
  });

  it('keeps a committed offset', async () => {
    const admin = adminStub();
    const consumer = consumerStub(admin);
    consumer.committed.mockResolvedValue([{ topic: 't', partition: 0, offset: '7' }]);
    const kafka = kafkaStub(consumer);
    const member = new KafkaGroupMember(kafka, config(), true);

    const result = await rebalanceCallback(kafka)({ code: -175 }, [{ topic: 't', partition: 0 }]);

    expect(result).toEqual([{ topic: 't', partition: 0, offset: 7 }]);
    expect(admin.fetchTopicOffsets).not.toHaveBeenCalled();
  });

  it('leaves start offsets to the client when not startAtLogEnd', async () => {
    const admin = adminStub();
    const consumer = consumerStub(admin);
    const kafka = kafkaStub(consumer);
    const member = new KafkaGroupMember(kafka, config(), false);

    const result = await rebalanceCallback(kafka)({ code: -175 }, [{ topic: 't', partition: 0 }]);

    expect(result).toBeUndefined();
    expect(consumer.committed).not.toHaveBeenCalled();
  });

  it('still resolves joined when pinning fails', async () => {
    const admin = adminStub();
    const consumer = consumerStub(admin);
    consumer.committed.mockRejectedValue(new Error('broker unreachable'));
    const kafka = kafkaStub(consumer);
    const member = new KafkaGroupMember(kafka, config(), true);

    await rebalanceCallback(kafka)({ code: -175 }, [{ topic: 't', partition: 0 }]).catch(
      () => undefined,
    );

    await expect(member.joined('g', 1000)).resolves.toBeUndefined();
  });

  it('disconnects the admin after reading log ends', async () => {
    const admin = adminStub();
    admin.fetchTopicOffsets.mockResolvedValue([
      { partition: 0, high: '42', low: '0', offset: '42' },
    ]);
    const consumer = consumerStub(admin);
    consumer.committed.mockResolvedValue([{ topic: 't', partition: 0, offset: null }]);
    const kafka = kafkaStub(consumer);
    const member = new KafkaGroupMember(kafka, config(), true);

    await rebalanceCallback(kafka)({ code: -175 }, [{ topic: 't', partition: 0 }]);

    expect(admin.disconnect).toHaveBeenCalledTimes(1);
  });
});
