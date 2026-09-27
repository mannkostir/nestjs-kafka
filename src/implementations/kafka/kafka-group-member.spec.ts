import type { KafkaJS } from '@confluentinc/kafka-javascript';
import { Logger } from '@nestjs/common';
import { KafkaGroupMember } from './kafka-group-member.js';

const adminStub = () => ({
  connect: jest.fn().mockResolvedValue(undefined),
  disconnect: jest.fn().mockResolvedValue(undefined),
  fetchOffsets: jest.fn().mockResolvedValue([]),
  fetchTopicOffsets: jest.fn().mockResolvedValue([]),
});

const consumerStub = (admin: ReturnType<typeof adminStub>) => ({
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
  afterEach(() => {
    jest.useRealTimers();
  });

  it('resolves joined on the first assignment', async () => {
    const kafka = kafkaStub(consumerStub(adminStub()));
    const member = new KafkaGroupMember(kafka, config(), false);

    await rebalanceCallback(kafka)({ code: -175 }, [{ topic: 't', partition: 0 }]);

    await expect(member.joined(1000)).resolves.toBeUndefined();
  });

  it('resolves joined on an empty first assignment', async () => {
    const kafka = kafkaStub(consumerStub(adminStub()));
    const member = new KafkaGroupMember(kafka, config(), false);

    await rebalanceCallback(kafka)({ code: -175 }, []);

    await expect(member.joined(1000)).resolves.toBeUndefined();
  });

  it('ignores a revocation', async () => {
    jest.useFakeTimers();
    const kafka = kafkaStub(consumerStub(adminStub()));
    const member = new KafkaGroupMember(kafka, config(), false);

    await rebalanceCallback(kafka)({ code: -174 }, [{ topic: 't', partition: 0 }]);

    const assertion = expect(member.joined(1000)).rejects.toThrow(
      /Consumer group "g" received no partition assignment within 1000 ms/,
    );
    jest.advanceTimersByTime(1000);
    await assertion;
  });

  it('rejects naming the group when no assignment arrives in time', async () => {
    jest.useFakeTimers();
    const kafka = kafkaStub(consumerStub(adminStub()));
    const member = new KafkaGroupMember(kafka, config(), false);

    const assertion = expect(member.joined(1000)).rejects.toThrow(
      /Consumer group "g" received no partition assignment within 1000 ms/,
    );
    jest.advanceTimersByTime(1000);
    await assertion;
  });
});

describe('KafkaGroupMember start offset pinning', () => {
  it('starts an uncommitted partition at the log end when startAtLogEnd', async () => {
    const admin = adminStub();
    admin.fetchOffsets.mockResolvedValue([
      { topic: 't', partitions: [{ partition: 0, offset: '-1' }] },
    ]);
    admin.fetchTopicOffsets.mockResolvedValue([
      { partition: 0, high: '42', low: '0', offset: '42' },
    ]);
    const consumer = consumerStub(admin);
    const kafka = kafkaStub(consumer);
    const member = new KafkaGroupMember(kafka, config(), true);

    const result = await rebalanceCallback(kafka)({ code: -175 }, [{ topic: 't', partition: 0 }]);

    expect(result).toEqual([{ topic: 't', partition: 0, offset: 42 }]);
    expect(typeof (result as { offset: number }[])[0].offset).toBe('number');
  });

  it('keeps a committed offset', async () => {
    const admin = adminStub();
    admin.fetchOffsets.mockResolvedValue([
      { topic: 't', partitions: [{ partition: 0, offset: '7' }] },
    ]);
    const consumer = consumerStub(admin);
    const kafka = kafkaStub(consumer);
    const member = new KafkaGroupMember(kafka, config(), true);

    const result = await rebalanceCallback(kafka)({ code: -175 }, [{ topic: 't', partition: 0 }]);

    expect(result).toEqual([{ topic: 't', partition: 0, offset: 7 }]);
    expect(admin.fetchTopicOffsets).not.toHaveBeenCalled();
  });

  it('keeps a committed offset of zero', async () => {
    const admin = adminStub();
    admin.fetchOffsets.mockResolvedValue([
      { topic: 't', partitions: [{ partition: 0, offset: '0' }] },
    ]);
    const consumer = consumerStub(admin);
    const kafka = kafkaStub(consumer);
    const member = new KafkaGroupMember(kafka, config(), true);

    const result = await rebalanceCallback(kafka)({ code: -175 }, [{ topic: 't', partition: 0 }]);

    expect(result).toEqual([{ topic: 't', partition: 0, offset: 0 }]);
    expect(admin.fetchTopicOffsets).not.toHaveBeenCalled();
  });

  it('leaves start offsets to the client when not startAtLogEnd', async () => {
    const admin = adminStub();
    const consumer = consumerStub(admin);
    const kafka = kafkaStub(consumer);
    const member = new KafkaGroupMember(kafka, config(), false);

    const result = await rebalanceCallback(kafka)({ code: -175 }, [{ topic: 't', partition: 0 }]);

    expect(result).toBeUndefined();
    expect(admin.fetchOffsets).not.toHaveBeenCalled();
  });

  it('disconnects the admin after reading log ends', async () => {
    const admin = adminStub();
    admin.fetchOffsets.mockResolvedValue([
      { topic: 't', partitions: [{ partition: 0, offset: '-1' }] },
    ]);
    admin.fetchTopicOffsets.mockResolvedValue([
      { partition: 0, high: '42', low: '0', offset: '42' },
    ]);
    const consumer = consumerStub(admin);
    const kafka = kafkaStub(consumer);
    const member = new KafkaGroupMember(kafka, config(), true);

    await rebalanceCallback(kafka)({ code: -175 }, [{ topic: 't', partition: 0 }]);

    expect(admin.disconnect).toHaveBeenCalledTimes(1);
  });
});

describe('KafkaGroupMember pin failure fallback', () => {
  let warn: jest.SpiedFunction<typeof Logger.prototype.warn>;

  beforeEach(() => {
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    warn.mockRestore();
  });

  it('still resolves joined when pinning fails', async () => {
    const admin = adminStub();
    admin.fetchOffsets.mockRejectedValue(new Error('broker unreachable'));
    const consumer = consumerStub(admin);
    const kafka = kafkaStub(consumer);
    const member = new KafkaGroupMember(kafka, config(), true);

    await rebalanceCallback(kafka)({ code: -175 }, [{ topic: 't', partition: 0 }]);

    await expect(member.joined(1000)).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('Consumer group "g"'));
  });

  it('disconnects the admin when connect fails', async () => {
    const admin = adminStub();
    admin.connect.mockRejectedValue(new Error('connection refused'));
    const consumer = consumerStub(admin);
    const kafka = kafkaStub(consumer);
    const member = new KafkaGroupMember(kafka, config(), true);

    await rebalanceCallback(kafka)({ code: -175 }, [{ topic: 't', partition: 0 }]);

    expect(admin.disconnect).toHaveBeenCalledTimes(1);
    await expect(member.joined(1000)).resolves.toBeUndefined();
  });

  it('falls back to the client default when a log end is unknown', async () => {
    const admin = adminStub();
    admin.fetchOffsets.mockResolvedValue([
      { topic: 't', partitions: [{ partition: 0, offset: '-1' }] },
    ]);
    admin.fetchTopicOffsets.mockResolvedValue([]);
    const consumer = consumerStub(admin);
    const kafka = kafkaStub(consumer);
    const member = new KafkaGroupMember(kafka, config(), true);

    const result = await rebalanceCallback(kafka)({ code: -175 }, [{ topic: 't', partition: 0 }]);

    expect(result).toBeUndefined();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('t:0'));
    await expect(member.joined(1000)).resolves.toBeUndefined();
  });
});
