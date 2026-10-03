import type { KafkaJS } from '@confluentinc/kafka-javascript';
import { Logger } from '@nestjs/common';
import { KafkaGroupMember } from './kafka-group-member.js';
import { JoinFailureDetector } from './join-failure-detector.js';

const adminStub = () => ({
  connect: jest.fn().mockResolvedValue(undefined),
  disconnect: jest.fn().mockResolvedValue(undefined),
  fetchOffsets: jest.fn().mockResolvedValue([]),
  fetchTopicOffsets: jest.fn().mockResolvedValue([]),
});

const consumerStub = () => ({
  dependentAdmin: jest.fn().mockReturnValue(adminStub()),
});

const kafkaStub = (
  admin: ReturnType<typeof adminStub>,
  consumer: ReturnType<typeof consumerStub> = consumerStub(),
) =>
  ({
    consumer: jest.fn().mockReturnValue(consumer),
    admin: jest.fn().mockReturnValue(admin),
  }) as unknown as KafkaJS.Kafka;

const config = (): KafkaJS.ConsumerConfig => ({ groupId: 'g' });

const clientLoggerStub = () => ({
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
  namespace: jest.fn(),
  setLogLevel: jest.fn(),
});

const consumerLogger = (kafka: KafkaJS.Kafka) =>
  (kafka.consumer as jest.Mock).mock.calls.at(-1)[0].kafkaJS.logger as KafkaJS.Logger;

const rebalanceCallback = (kafka: KafkaJS.Kafka) =>
  (kafka.consumer as jest.Mock).mock.calls.at(-1)[0].rebalance_cb as (
    event: { code: number },
    assignment: KafkaJS.TopicPartition[],
  ) => Promise<unknown>;

describe('KafkaGroupMember construction', () => {
  it('installs the rebalance callback outside the kafkaJS block', () => {
    const kafka = kafkaStub(adminStub());
    const passedConfig = config();

    new KafkaGroupMember(kafka, passedConfig, false, clientLoggerStub());

    const call = (kafka.consumer as jest.Mock).mock.calls[0][0];
    expect(typeof call.rebalance_cb).toBe('function');
    expect(call.kafkaJS).toEqual({ ...passedConfig, logger: expect.any(JoinFailureDetector) });
  });

  it('hands the consumer a logger that forwards to the client logger', () => {
    const kafka = kafkaStub(adminStub());
    const clientLogger = clientLoggerStub();
    new KafkaGroupMember(kafka, config(), false, clientLogger);

    consumerLogger(kafka).warn('coordinator moved');

    expect(clientLogger.warn).toHaveBeenCalledWith('coordinator moved', undefined);
  });
});

describe('KafkaGroupMember.joined', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('resolves joined on the first assignment', async () => {
    const kafka = kafkaStub(adminStub());
    const member = new KafkaGroupMember(kafka, config(), false, clientLoggerStub());

    await rebalanceCallback(kafka)({ code: -175 }, [{ topic: 't', partition: 0 }]);

    await expect(member.joined(1000)).resolves.toBeUndefined();
  });

  it('resolves joined on an empty first assignment', async () => {
    const kafka = kafkaStub(adminStub());
    const member = new KafkaGroupMember(kafka, config(), false, clientLoggerStub());

    await rebalanceCallback(kafka)({ code: -175 }, []);

    await expect(member.joined(1000)).resolves.toBeUndefined();
  });

  it('rejects naming the group and the reason as soon as group authorization fails', async () => {
    const kafka = kafkaStub(adminStub());
    const member = new KafkaGroupMember(kafka, config(), false, clientLoggerStub());
    const joining = member.joined(60000);

    consumerLogger(kafka).error('[Consumer] Broker: Group authorization failed');

    await expect(joining).rejects.toThrow(
      'Consumer group "g" cannot join: Broker: Group authorization failed. ' +
        'Grant this client Read on the group and Describe and Read on its topics.',
    );
  });

  it('still resolves joined when the assignment arrives before any authorization failure', async () => {
    const kafka = kafkaStub(adminStub());
    const member = new KafkaGroupMember(kafka, config(), false, clientLoggerStub());

    await rebalanceCallback(kafka)({ code: -175 }, [{ topic: 't', partition: 0 }]);
    consumerLogger(kafka).error('Broker: Group authorization failed');

    await expect(member.joined(60000)).resolves.toBeUndefined();
  });

  it('explains the timeout without blaming authorization', async () => {
    jest.useFakeTimers();
    const kafka = kafkaStub(adminStub());
    const member = new KafkaGroupMember(kafka, config(), false, clientLoggerStub());

    const assertion = expect(member.joined(1000)).rejects.toThrow(
      'Consumer group "g" received no partition assignment within 1000 ms. ' +
        'Check that the brokers are reachable and that every other member of the group is still polling. ' +
        'Raising rebalanceTimeout extends this wait but also raises max.poll.interval.ms.',
    );
    jest.advanceTimersByTime(1000);
    await assertion;
  });

  it('ignores a revocation', async () => {
    jest.useFakeTimers();
    const kafka = kafkaStub(adminStub());
    const member = new KafkaGroupMember(kafka, config(), false, clientLoggerStub());

    await rebalanceCallback(kafka)({ code: -174 }, [{ topic: 't', partition: 0 }]);

    const assertion = expect(member.joined(1000)).rejects.toThrow(
      /Consumer group "g" received no partition assignment within 1000 ms/,
    );
    jest.advanceTimersByTime(1000);
    await assertion;
  });

  it('rejects naming the group when no assignment arrives in time', async () => {
    jest.useFakeTimers();
    const kafka = kafkaStub(adminStub());
    const member = new KafkaGroupMember(kafka, config(), false, clientLoggerStub());

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
    const kafka = kafkaStub(admin);
    const member = new KafkaGroupMember(kafka, config(), true, clientLoggerStub());

    const result = await rebalanceCallback(kafka)({ code: -175 }, [{ topic: 't', partition: 0 }]);

    expect(result).toEqual([{ topic: 't', partition: 0, offset: 42 }]);
    expect(typeof (result as { offset: number }[])[0].offset).toBe('number');
  });

  it('keeps a committed offset', async () => {
    const admin = adminStub();
    admin.fetchOffsets.mockResolvedValue([
      { topic: 't', partitions: [{ partition: 0, offset: '7' }] },
    ]);
    const kafka = kafkaStub(admin);
    const member = new KafkaGroupMember(kafka, config(), true, clientLoggerStub());

    const result = await rebalanceCallback(kafka)({ code: -175 }, [{ topic: 't', partition: 0 }]);

    expect(result).toEqual([{ topic: 't', partition: 0, offset: 7 }]);
    expect(admin.fetchTopicOffsets).not.toHaveBeenCalled();
  });

  it('keeps a committed offset of zero', async () => {
    const admin = adminStub();
    admin.fetchOffsets.mockResolvedValue([
      { topic: 't', partitions: [{ partition: 0, offset: '0' }] },
    ]);
    const kafka = kafkaStub(admin);
    const member = new KafkaGroupMember(kafka, config(), true, clientLoggerStub());

    const result = await rebalanceCallback(kafka)({ code: -175 }, [{ topic: 't', partition: 0 }]);

    expect(result).toEqual([{ topic: 't', partition: 0, offset: 0 }]);
    expect(admin.fetchTopicOffsets).not.toHaveBeenCalled();
  });

  it('leaves start offsets to the client when not startAtLogEnd', async () => {
    const admin = adminStub();
    const kafka = kafkaStub(admin);
    const member = new KafkaGroupMember(kafka, config(), false, clientLoggerStub());

    const result = await rebalanceCallback(kafka)({ code: -175 }, [{ topic: 't', partition: 0 }]);

    expect(result).toBeUndefined();
    expect(admin.fetchOffsets).not.toHaveBeenCalled();
  });

  it('reads start offsets through its own admin client, never through the consumer', async () => {
    const admin = adminStub();
    admin.fetchOffsets.mockResolvedValue([
      { topic: 't', partitions: [{ partition: 0, offset: '7' }] },
    ]);
    const consumer = consumerStub();
    const kafka = kafkaStub(admin, consumer);
    new KafkaGroupMember(kafka, config(), true, clientLoggerStub());

    await rebalanceCallback(kafka)({ code: -175 }, [{ topic: 't', partition: 0 }]);

    expect(consumer.dependentAdmin).not.toHaveBeenCalled();
  });

  it('disconnects the admin after reading log ends', async () => {
    const admin = adminStub();
    admin.fetchOffsets.mockResolvedValue([
      { topic: 't', partitions: [{ partition: 0, offset: '-1' }] },
    ]);
    admin.fetchTopicOffsets.mockResolvedValue([
      { partition: 0, high: '42', low: '0', offset: '42' },
    ]);
    const kafka = kafkaStub(admin);
    const member = new KafkaGroupMember(kafka, config(), true, clientLoggerStub());

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
    const kafka = kafkaStub(admin);
    const member = new KafkaGroupMember(kafka, config(), true, clientLoggerStub());

    await rebalanceCallback(kafka)({ code: -175 }, [{ topic: 't', partition: 0 }]);

    await expect(member.joined(1000)).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('Consumer group "g"'));
  });

  it('disconnects the admin when connect fails', async () => {
    const admin = adminStub();
    admin.connect.mockRejectedValue(new Error('connection refused'));
    const kafka = kafkaStub(admin);
    const member = new KafkaGroupMember(kafka, config(), true, clientLoggerStub());

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
    const kafka = kafkaStub(admin);
    const member = new KafkaGroupMember(kafka, config(), true, clientLoggerStub());

    const result = await rebalanceCallback(kafka)({ code: -175 }, [{ topic: 't', partition: 0 }]);

    expect(result).toBeUndefined();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('t:0'));
    await expect(member.joined(1000)).resolves.toBeUndefined();
  });

  it('falls back to the client default when pinning outlasts the pin timeout', async () => {
    const admin = adminStub();
    admin.connect.mockReturnValue(new Promise(() => undefined));
    const kafka = kafkaStub(admin);
    const member = new KafkaGroupMember(kafka, config(), true, clientLoggerStub(), 20);

    const result = await rebalanceCallback(kafka)({ code: -175 }, [{ topic: 't', partition: 0 }]);

    expect(result).toBeUndefined();
    await expect(member.joined(1000)).resolves.toBeUndefined();
  });

  it('warns naming the group and the pin timeout when pinning outlasts it', async () => {
    const admin = adminStub();
    admin.connect.mockReturnValue(new Promise(() => undefined));
    const kafka = kafkaStub(admin);
    new KafkaGroupMember(kafka, config(), true, clientLoggerStub(), 20);

    await rebalanceCallback(kafka)({ code: -175 }, [{ topic: 't', partition: 0 }]);

    expect(warn).toHaveBeenCalledWith(
      expect.stringMatching(/Consumer group "g".*timed out after 20 ms/),
    );
  });

  it('returns the pinned offsets when pinning finishes within the pin timeout', async () => {
    const admin = adminStub();
    admin.fetchOffsets.mockResolvedValue([
      { topic: 't', partitions: [{ partition: 0, offset: '7' }] },
    ]);
    const kafka = kafkaStub(admin);
    new KafkaGroupMember(kafka, config(), true, clientLoggerStub(), 1000);

    const result = await rebalanceCallback(kafka)({ code: -175 }, [{ topic: 't', partition: 0 }]);

    expect(result).toEqual([{ topic: 't', partition: 0, offset: 7 }]);
    expect(warn).not.toHaveBeenCalled();
  });
});
