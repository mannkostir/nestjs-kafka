import { KafkaJS } from '@confluentinc/kafka-javascript';
import { ConnectorHealthState } from '../../health/connector-health-state.js';
import { KafkaProducer } from './kafka-producer.js';
import { KafkaConsumer } from './kafka-consumer.js';
import { TopicNamespacer } from './topic-namespacer.js';
import { MessageFormat } from '../../types/message-format.type.js';
import { KafkaTopicProvisioner } from './kafka-topic-provisioner.js';

const producerStub = () => ({
  connect: jest.fn().mockResolvedValue(undefined),
  disconnect: jest.fn().mockResolvedValue(undefined),
  send: jest.fn().mockResolvedValue([]),
});

const deferred = () => {
  let resolve: () => void = () => undefined;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
};

const subscription = { topicPatterns: ['orders'], consumer: { fromBeginning: true }, errorHandling: { type: 'fail' as const, backoff: false as const } };
const assignment = [{ topic: 'orders', partition: 0 }];

const fixture = () => {
  const health = new ConnectorHealthState();
  const configs: Array<{ rebalance_cb: (event: { code: number }, partitions: KafkaJS.TopicPartition[]) => Promise<unknown>; kafkaJS: { logger: KafkaJS.Logger } }> = [];
  const consumers: Array<ReturnType<typeof consumerStub>> = [];
  const clientLogger = { info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn(), namespace: jest.fn(), setLogLevel: jest.fn() };
  const consumerStub = () => ({
    connect: jest.fn().mockResolvedValue(undefined),
    subscribe: jest.fn().mockResolvedValue(undefined),
    disconnect: jest.fn().mockResolvedValue(undefined),
    assignment: jest.fn().mockReturnValue(assignment),
    run: jest.fn().mockImplementation(async () => { await configs.at(-1)!.rebalance_cb({ code: -175 }, assignment); }),
  });
  const kafka = { consumer: jest.fn((config) => {
    configs.push(config);
    const consumer = consumerStub();
    consumers.push(consumer);
    return consumer;
  }) } as unknown as KafkaJS.Kafka;
  const provisioner = { createMissing: jest.fn().mockResolvedValue(undefined), assertExisting: jest.fn().mockResolvedValue(undefined) };
  const options = { namespace: 'test', health, clientLogger, topicProvisioner: provisioner as unknown as KafkaTopicProvisioner, shutdownTimeout: 5 };
  const consumer = new KafkaConsumer(kafka, options);
  return { health, consumer, consumers, configs, provisioner, clientLogger, kafka };
};

const payload = () => ({
  batch: { topic: 'orders', partition: 0, messages: [{ value: Buffer.from('{"payload":1}'), key: null, headers: {}, timestamp: '0', offset: '0' }] },
  isRunning: () => true,
  isStale: () => false,
  resolveOffset: jest.fn(),
}) as unknown as KafkaJS.EachBatchPayload;

describe('producer health observation', () => {
  it('marks successful connection', async () => {
    const health = new ConnectorHealthState();
    const options = { messageFormat: MessageFormat.JSON, health };
    const producer = new KafkaProducer(producerStub() as unknown as KafkaJS.Producer, new TopicNamespacer(), options);
    await producer.connect();

    expect(health.snapshot().producerConnected).toBe(true);
  });

  it('clears connection before a pending disconnect completes', async () => {
    const health = new ConnectorHealthState();
    const client = producerStub();
    const options = { messageFormat: MessageFormat.JSON, health };
    const producer = new KafkaProducer(client as unknown as KafkaJS.Producer, new TopicNamespacer(), options);
    await producer.connect();
    const disconnect = deferred();
    client.disconnect.mockReturnValue(disconnect.promise);
    const closing = producer.disconnect();

    expect(health.snapshot().producerConnected).toBe(false);
    disconnect.resolve();
    await closing;
  });

  it('keeps failed connection false and preserves the original error', async () => {
    const health = new ConnectorHealthState();
    const client = producerStub();
    const error = new Error('connection refused');
    client.connect.mockRejectedValue(error);
    const options = { messageFormat: MessageFormat.JSON, health };
    const producer = new KafkaProducer(client as unknown as KafkaJS.Producer, new TopicNamespacer(), options);

    await expect(producer.connect()).rejects.toBe(error);
    expect(health.snapshot().producerConnected).toBe(false);
  });

  it('does not resurrect a pending connection after shutdown', async () => {
    const health = new ConnectorHealthState();
    const client = producerStub();
    const connecting = deferred();
    client.connect.mockReturnValue(connecting.promise);
    const options = { messageFormat: MessageFormat.JSON, health };
    const producer = new KafkaProducer(client as unknown as KafkaJS.Producer, new TopicNamespacer(), options);
    const starting = producer.connect();
    await producer.disconnect();
    connecting.resolve();
    await starting;

    expect(health.snapshot().producerConnected).toBe(false);
  });

  it('keeps failed shutdown false without changing the logging policy', async () => {
    const health = new ConnectorHealthState();
    const client = producerStub();
    const options = { messageFormat: MessageFormat.JSON, health };
    const producer = new KafkaProducer(client as unknown as KafkaJS.Producer, new TopicNamespacer(), options);
    await producer.connect();
    client.disconnect.mockRejectedValue(new Error('disconnect failed'));
    await producer.disconnect();

    expect(health.snapshot().producerConnected).toBe(false);
  });
});

describe('consumer health observation', () => {
  it('observes the namespaced handler group assignment', async () => {
    const f = fixture();
    await f.consumer.subscribe(subscription, jest.fn(), 'g');

    expect(f.health.snapshot().groups[0]).toEqual({ groupId: 'test-g', joined: true, assignment, lastWorkerError: null });
  });

  it('observes revocation after startup', async () => {
    const f = fixture();
    await f.consumer.subscribe(subscription, jest.fn(), 'g');
    await f.configs[0].rebalance_cb({ code: -174 }, assignment);

    expect(f.health.snapshot().groups[0]).toMatchObject({ joined: false, assignment: [] });
  });

  it('observes reassignment after revocation', async () => {
    const f = fixture();
    await f.consumer.subscribe(subscription, jest.fn(), 'g');
    await f.configs[0].rebalance_cb({ code: -174 }, assignment);
    await f.configs[0].rebalance_cb({ code: -175 }, [{ topic: 'orders', partition: 1 }]);

    expect(f.health.snapshot().groups[0].assignment).toEqual([{ topic: 'orders', partition: 1 }]);
  });

  it('reads actual assignment through the supported client API', async () => {
    const f = fixture();
    await f.consumer.subscribe(subscription, jest.fn(), 'g');
    f.consumers[0].assignment.mockReturnValue([{ topic: 'actual', partition: 2 }]);
    f.consumer.observeHealthAssignments();

    expect(f.health.snapshot().groups[0].assignment).toEqual([{ topic: 'actual', partition: 2 }]);
  });

  it('reports an assignment read failure as unjoined with a diagnostic', async () => {
    const f = fixture();
    await f.consumer.subscribe(subscription, jest.fn(), 'g');
    f.consumers[0].assignment.mockImplementation(() => { throw new Error('client no longer connected'); });
    f.consumer.observeHealthAssignments();

    expect(f.health.snapshot().groups[0]).toMatchObject({ joined: false, assignment: [], lastWorkerError: { message: 'client no longer connected' } });
  });

  it('supports a joined group with no partitions', async () => {
    const f = fixture();
    await f.consumer.subscribe(subscription, jest.fn(), 'g');
    await f.configs[0].rebalance_cb({ code: -175 }, []);
    f.consumers[0].assignment.mockReturnValue([]);
    f.consumer.observeHealthAssignments();

    expect(f.health.snapshot().groups[0]).toMatchObject({ joined: true, assignment: [] });
  });

  it('leaves a pattern-only subscription unjoined until a real assignment', async () => {
    const f = fixture();
    const original = (f.kafka.consumer as jest.Mock).getMockImplementation()!;
    (f.kafka.consumer as jest.Mock).mockImplementation((config) => {
      const consumer = original(config);
      consumer.run.mockResolvedValue(undefined);
      return consumer;
    });
    await f.consumer.subscribe({ ...subscription, topicPatterns: [/^orders$/] }, jest.fn(), 'g');

    expect(f.health.snapshot().groups[0]).toMatchObject({ joined: false, assignment: [] });
  });

  it('invalidates observations before failed disconnect cleanup', async () => {
    const f = fixture();
    await f.consumer.subscribe(subscription, jest.fn(), 'g');
    f.consumers[0].disconnect.mockRejectedValue(new Error('disconnect failed'));
    await f.consumer.disconnectAll();
    await f.configs[0].rebalance_cb({ code: -175 }, assignment);

    expect(f.health.snapshot().groups[0]).toMatchObject({ joined: false, assignment: [] });
  });

  it('records escaping delivery failures without changing fail policy', async () => {
    const f = fixture();
    const error = new Error('handler failed');
    await f.consumer.subscribe(subscription, jest.fn().mockRejectedValue(error), 'g');
    const run = (f.consumers[0].run as jest.Mock).mock.calls[0][0] as KafkaJS.ConsumerRunConfig;

    await expect(run.eachBatch!(payload())).rejects.toBe(error);
    expect(f.health.snapshot().groups[0].lastWorkerError).toEqual({ message: 'handler failed' });
  });

  it('records batch failures while preserving the original error', async () => {
    const f = fixture();
    const error = new Error('batch failed');
    await f.consumer.subscribeBatch(subscription, jest.fn().mockRejectedValue(error), 'g');
    const run = (f.consumers[0].run as jest.Mock).mock.calls[0][0] as KafkaJS.ConsumerRunConfig;

    await expect(run.eachBatch!(payload())).rejects.toBe(error);
    expect(f.health.snapshot().groups[0].lastWorkerError).toEqual({ message: 'batch failed' });
  });

  it('preserves unprintable delivery failures', async () => {
    const f = fixture();
    const error: unknown = Object.create(null);
    await f.consumer.subscribe(subscription, jest.fn().mockRejectedValue(error), 'g');
    const run = (f.consumers[0].run as jest.Mock).mock.calls[0][0] as KafkaJS.ConsumerRunConfig;

    await expect(run.eachBatch!(payload())).rejects.toBe(error);
    expect(f.health.snapshot().groups[0].lastWorkerError).toEqual({ message: 'Unknown worker error' });
  });

  it('keeps the ignore policy successful', async () => {
    const f = fixture();
    await f.consumer.subscribe({ ...subscription, errorHandling: { type: 'ignore' } }, jest.fn().mockRejectedValue(new Error('ignored')), 'g');
    const run = (f.consumers[0].run as jest.Mock).mock.calls[0][0] as KafkaJS.ConsumerRunConfig;

    await expect(run.eachBatch!(payload())).resolves.toBeUndefined();
  });

  it('retains client worker errors while forwarding the custom logger', async () => {
    const f = fixture();
    await f.consumer.subscribe(subscription, jest.fn(), 'g');
    f.configs[0].kafkaJS.logger.error('worker failed', { worker: 1 });

    expect(f.health.snapshot().groups[0].lastWorkerError).toEqual({ message: 'worker failed' });
    expect(f.clientLogger.error).toHaveBeenCalledWith('worker failed', { worker: 1 });
  });

  it('ignores callbacks from a replaced consumer', async () => {
    const f = fixture();
    await f.consumer.subscribe(subscription, jest.fn(), 'g');
    await f.consumer.subscribe(subscription, jest.fn(), 'g');
    await f.configs[0].rebalance_cb({ code: -174 }, assignment);
    f.configs[0].kafkaJS.logger.error('old worker failed');

    expect(f.health.snapshot().groups[0]).toMatchObject({ joined: true, lastWorkerError: null });
  });

  it('retains a failed startup as unjoined', async () => {
    const f = fixture();
    f.provisioner.assertExisting.mockRejectedValue(new Error('provision failed'));
    await expect(f.consumer.subscribe(subscription, jest.fn(), 'g')).rejects.toThrow('provision failed');

    expect(f.health.snapshot().groups[0]).toMatchObject({ joined: false, assignment: [] });
  });

  it('clears health before cleanup of a rejected run', async () => {
    const f = fixture();
    const disconnecting = deferred();
    const original = (f.kafka.consumer as jest.Mock).getMockImplementation()!;
    (f.kafka.consumer as jest.Mock).mockImplementation((config) => {
      const consumer = original(config);
      consumer.run.mockRejectedValue(new Error('run failed'));
      consumer.disconnect.mockReturnValue(disconnecting.promise);
      return consumer;
    });
    const starting = f.consumer.subscribe(subscription, jest.fn(), 'g');
    const rejected = expect(starting).rejects.toThrow('run failed');
    await new Promise((resolve) => setImmediate(resolve));

    expect(f.health.snapshot().groups[0]).toMatchObject({ joined: false, assignment: [] });
    disconnecting.resolve();
    await rejected;
  });

  it('clears health when shutdown aborts the first assignment wait', async () => {
    const f = fixture();
    const original = (f.kafka.consumer as jest.Mock).getMockImplementation()!;
    (f.kafka.consumer as jest.Mock).mockImplementation((config) => {
      const consumer = original(config);
      consumer.run.mockResolvedValue(undefined);
      return consumer;
    });
    const starting = f.consumer.subscribe(subscription, jest.fn(), 'g');
    const rejected = expect(starting).rejects.toThrow('stopped subscribing');
    await new Promise((resolve) => setImmediate(resolve));
    await f.consumer.disconnectAll();
    await rejected;

    expect(f.health.snapshot().groups[0]).toMatchObject({ joined: false, assignment: [] });
    expect(f.consumers[0].disconnect).toHaveBeenCalledTimes(1);
  });

  it('invalidates a start still connecting when shutdown times out', async () => {
    const f = fixture();
    const connecting = deferred();
    const original = (f.kafka.consumer as jest.Mock).getMockImplementation()!;
    (f.kafka.consumer as jest.Mock).mockImplementation((config) => {
      const consumer = original(config);
      (consumer.connect as jest.Mock).mockReturnValue(connecting.promise);
      return consumer;
    });
    const starting = f.consumer.subscribe(subscription, jest.fn(), 'g');
    const rejected = expect(starting).rejects.toThrow('stopped subscribing');
    await new Promise((resolve) => setImmediate(resolve));
    await f.consumer.disconnectAll();
    connecting.resolve();
    await rejected;
    await f.configs[0].rebalance_cb({ code: -175 }, assignment);

    expect(f.health.snapshot().groups[0]).toMatchObject({ joined: false, assignment: [] });
    expect(f.consumers[0].disconnect).toHaveBeenCalledTimes(1);
  });
});
