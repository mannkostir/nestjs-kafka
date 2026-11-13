import { KafkaJS, RdKafka } from '@confluentinc/kafka-javascript';
import { Logger } from '@nestjs/common';
import { KafkaConsumer } from '../../src/implementations/kafka/kafka-consumer.js';
import { KafkaHandlerRoutes } from '../../src/implementations/kafka/kafka-handler-routes.js';
import { KafkaSharedGroupDispatcher } from '../../src/implementations/kafka/kafka-shared-group-dispatcher.js';
import { startBroker, StartedBroker } from './kafka-broker.js';
import { eventually, waitFor } from './wait.js';

const WAIT_MS = 30000;

class ObservedKafka extends KafkaJS.Kafka {
  consumerInstance?: KafkaJS.Consumer;
  readonly rebalances: Array<{ code: number }> = [];
  activePayload?: KafkaJS.EachBatchPayload;

  override consumer(config: KafkaJS.ConsumerConstructorConfig): KafkaJS.Consumer {
    const rebalance = config.rebalance_cb;
    const consumer = super.consumer({
      ...config,
      'partition.assignment.strategy': 'range',
      'js.consumer.max.batch.size': 32,
      rebalance_cb: async (event: { code: number }, assignment: RdKafka.TopicPartition[]) => {
        this.rebalances.push({ code: event.code });
        if (typeof rebalance === 'function') {
          return await rebalance(event, assignment);
        }
      },
    });
    const run = consumer.run.bind(consumer);
    consumer.run = (options) => run({
      ...options,
      eachBatch: async (payload) => {
        this.activePayload = payload;
        await options?.eachBatch?.(payload);
      },
    });
    this.consumerInstance = consumer;
    return consumer;
  }

  get client(): KafkaJS.Consumer {
    if (!this.consumerInstance) {
      throw new Error('The subscription has not created a consumer');
    }
    return this.consumerInstance;
  }

  paused(topic: string, partition: number): boolean {
    return this.client.paused().some((entry) => entry.topic === topic && entry.partitions.includes(partition));
  }
}

const gate = () => {
  let release: () => void = () => undefined;
  const promise = new Promise<void>((resolve) => { release = resolve; });
  return { promise, release };
};

describe('failure lifecycle against Kafka', () => {
  let broker: StartedBroker;
  let kafka: KafkaJS.Kafka;
  let admin: KafkaJS.Admin;
  let producer: KafkaJS.Producer;
  const adapters: KafkaConsumer<unknown>[] = [];
  const clients: KafkaJS.Consumer[] = [];
  const releases: Array<() => void> = [];

  const observedKafka = (clientId: string) => new ObservedKafka({
    kafkaJS: { clientId, brokers: broker.brokers, logLevel: KafkaJS.logLevel.NOTHING },
  });

  const adapterFor = (client: ObservedKafka) => {
    const adapter = new KafkaConsumer(client);
    adapters.push(adapter);
    return adapter;
  };

  const send = (topic: string, partition: number, count = 1) => producer.send({
    topic,
    messages: Array.from({ length: count }, (_, sequence) => ({ partition, value: JSON.stringify({ sequence }) })),
  });

  const offsetOf = async (groupId: string, topic: string, partition: number): Promise<number> => {
    const offsets = await admin.fetchOffsets({ groupId, topics: [topic] });
    const committed = offsets.flatMap((entry) => entry.partitions).find((entry) => entry.partition === partition);
    if (!committed) {
      throw new Error(`No offset returned for ${groupId}/${topic}/${partition}`);
    }
    return Number(committed.offset);
  };

  beforeAll(async () => {
    broker = await startBroker();
    kafka = new KafkaJS.Kafka({
      kafkaJS: { clientId: 'failure-lifecycle-observer', brokers: broker.brokers, logLevel: KafkaJS.logLevel.NOTHING },
    });
    admin = kafka.admin();
    producer = kafka.producer();
    await admin.connect();
    await producer.connect();
  });

  afterEach(async () => {
    releases.splice(0).forEach((release) => release());
    const results = [
      ...await Promise.allSettled(adapters.splice(0).map((adapter) => adapter.disconnectAll())),
      ...await Promise.allSettled(clients.splice(0).map((client) => client.disconnect())),
    ];
    for (const result of results) {
      if (result.status === 'rejected') {
        throw result.reason;
      }
    }
  });

  afterAll(async () => {
    await producer?.disconnect();
    await admin?.disconnect();
    await broker?.stop();
  });

  it('keeps a retained partition in fail backoff across an eager group rebalance', async () => {
    const topic = 'lifecycle.rebalance';
    const companion = 'lifecycle.companion';
    const groupId = 'lifecycle-rebalance';
    const backoffMs = 20000;
    await broker.createTopics([topic, companion], 1);
    const observed = observedKafka(groupId);
    const adapter = adapterFor(observed);
    const deliveries: Array<{ offset: string; at: number }> = [];
    await adapter.subscribe({
      topicPatterns: [topic],
      consumer: { fromBeginning: true, rebalanceTimeout: 10000, sessionTimeout: 6000 },
      errorHandling: { type: 'fail', backoff: { initialMs: backoffMs, maxMs: backoffMs } },
    }, async (_message, { offset }) => {
      deliveries.push({ offset, at: Date.now() });
      if (deliveries.length === 1) {
        throw new Error('fail before rebalance');
      }
    }, groupId);
    await send(topic, 0, 2);
    await waitFor(() => observed.paused(topic, 0), WAIT_MS);
    const rebalanceStart = observed.rebalances.length;
    const peer = kafka.consumer({
      'partition.assignment.strategy': 'range',
      kafkaJS: { groupId, fromBeginning: true, sessionTimeout: 6000, rebalanceTimeout: 10000 },
    });
    clients.push(peer);
    await peer.connect();
    await peer.subscribe({ topics: [companion] });
    await peer.run({ eachMessage: async () => undefined });
    await waitFor(() => {
      const events = observed.rebalances.slice(rebalanceStart);
      const revoked = events.findIndex(({ code }) => code === KafkaJS.ErrorCodes.ERR__REVOKE_PARTITIONS);
      return revoked >= 0 &&
        events.slice(revoked + 1).some(({ code }) => code === KafkaJS.ErrorCodes.ERR__ASSIGN_PARTITIONS) &&
        observed.client.assignment().some((entry) => entry.topic === topic && entry.partition === 0);
    }, WAIT_MS);
    expect(Date.now() - deliveries[0].at).toBeLessThan(backoffMs);
    expect(observed.client.assignment()).toContainEqual({ topic, partition: 0 });
    expect(observed.paused(topic, 0)).toBe(true);
    expect(await offsetOf(groupId, topic, 0)).toBeLessThanOrEqual(0);
    await waitFor(() => deliveries.length >= 3, WAIT_MS);

    expect(deliveries.map(({ offset }) => offset)).toEqual(['0', '0', '1']);
    expect(deliveries[1].at - deliveries[0].at).toBeGreaterThanOrEqual(backoffMs);
    await eventually(async () => { expect(await offsetOf(groupId, topic, 0)).toBe(2); });
  });

  it('lets another partition commit while a failed partition waits for backoff', async () => {
    const topic = 'lifecycle.concurrent';
    const groupId = 'lifecycle-concurrent';
    const backoffMs = 15000;
    await broker.createTopics([topic], 2);
    const observed = observedKafka(groupId);
    const adapter = adapterFor(observed);
    const deliveries: Array<{ partition: number; offset: string; at: number }> = [];
    await adapter.subscribe({
      topicPatterns: [topic],
      consumer: { fromBeginning: true, partitionsConsumedConcurrently: 2 },
      errorHandling: { type: 'fail', backoff: { initialMs: backoffMs, maxMs: backoffMs } },
    }, async (_message, { partition, offset }) => {
      const firstFailure = partition === 0 && !deliveries.some((entry) => entry.partition === 0);
      deliveries.push({ partition, offset, at: Date.now() });
      if (firstFailure) {
        throw new Error('only partition zero fails');
      }
    }, groupId);
    await send(topic, 0, 2);
    await waitFor(() => observed.paused(topic, 0), WAIT_MS);
    await send(topic, 1, 2);
    await eventually(async () => { expect(await offsetOf(groupId, topic, 1)).toBe(2); }, 10000);

    expect(observed.paused(topic, 0)).toBe(true);
    expect(await offsetOf(groupId, topic, 0)).toBeLessThanOrEqual(0);
    await waitFor(() => deliveries.filter(({ partition }) => partition === 0).length >= 3, WAIT_MS);
    const failedPartition = deliveries.filter(({ partition }) => partition === 0);
    expect(failedPartition.map(({ offset }) => offset)).toEqual(['0', '0', '1']);
    expect(failedPartition[1].at - failedPartition[0].at).toBeGreaterThanOrEqual(backoffMs);
    expect(deliveries.filter(({ partition }) => partition === 1).map(({ offset }) => offset)).toEqual(['0', '1']);
    await eventually(async () => { expect(await offsetOf(groupId, topic, 0)).toBe(2); });
  });

  it('leaves the stale tail for redelivery when max poll expires during a handler', async () => {
    const topic = 'lifecycle.stale';
    const groupId = 'lifecycle-stale';
    await broker.createTopics([topic], 1);
    await send(topic, 0, 65);
    const observed = observedKafka(groupId);
    const adapter = adapterFor(observed);
    const held = gate();
    releases.push(held.release);
    const deliveries: Array<{ offset: string; payload: KafkaJS.EachBatchPayload }> = [];
    let heldPayload: KafkaJS.EachBatchPayload | undefined;
    await adapter.subscribe({
      topicPatterns: [topic],
      consumer: { fromBeginning: true, rebalanceTimeout: 6000, sessionTimeout: 6000 },
      errorHandling: { type: 'fail' },
    }, async (_message, { offset }) => {
      const payload = observed.activePayload;
      if (!payload) {
        throw new Error('Missing real client batch payload');
      }
      deliveries.push({ offset, payload });
      if (!heldPayload && payload.batch.messages.length > 1) {
        heldPayload = payload;
        await held.promise;
      }
    }, groupId);
    await waitFor(() => heldPayload !== undefined, WAIT_MS);
    const stale = heldPayload;
    if (!stale) {
      throw new Error('No multi-record batch reached the handler');
    }
    await waitFor(() => stale.isStale(), WAIT_MS);
    expect(await offsetOf(groupId, topic, 0)).toBeLessThanOrEqual(Number(stale.batch.messages[0].offset));
    held.release();
    await eventually(async () => { expect(await offsetOf(groupId, topic, 0)).toBe(65); });

    expect(deliveries.filter(({ payload }) => payload === stale).map(({ offset }) => offset))
      .toEqual([stale.batch.messages[0].offset]);
    const redelivered = deliveries.filter(({ payload }) => payload !== stale).map(({ offset }) => offset);
    for (const message of stale.batch.messages.slice(1)) {
      expect(redelivered.filter((offset) => offset === message.offset)).toEqual([message.offset]);
    }
    expect(new Set(deliveries.map(({ offset }) => offset)))
      .toEqual(new Set(Array.from({ length: 65 }, (_, offset) => String(offset))));
  });

  it('pauses an unclaimed shared-group topic and preserves its offset for a later owner', async () => {
    const topic = 'lifecycle.unclaimed';
    const known = 'lifecycle.known';
    const other = 'lifecycle.other';
    const groupId = 'lifecycle-unclaimed';
    await broker.createTopics([topic, known, other], 1);
    const logger = new Logger('unexpected-topic-integration');
    const logged = jest.spyOn(logger, 'error');
    const handled: string[] = [];
    const route = {
      handlerName: 'known',
      eachBatch: async (payload: KafkaJS.EachBatchPayload) => {
        for (const message of payload.batch.messages) {
          handled.push(payload.batch.topic);
          payload.resolveOffset(message.offset);
        }
      },
    };
    const dispatcher = new KafkaSharedGroupDispatcher(
      KafkaHandlerRoutes.claim(groupId, [
        { topics: [known], route },
        { topics: [other], route: { ...route, handlerName: 'other' } },
      ]), new Set(), logger,
    );
    const consumer = kafka.consumer({ kafkaJS: { groupId, fromBeginning: true, autoCommitInterval: 100 } });
    clients.push(consumer);
    try {
      await consumer.connect();
      await consumer.subscribe({ topics: [topic, known, other] });
      await consumer.run({ eachBatchAutoResolve: false, eachBatch: (payload) => dispatcher.dispatch(payload) });
      await send(topic, 0, 2);
      await waitFor(() => consumer.paused().some((entry) => entry.topic === topic && entry.partitions.includes(0)), WAIT_MS);
      await send(known, 0);
      await eventually(async () => { expect(await offsetOf(groupId, known, 0)).toBe(1); });

      expect(handled).toEqual([known]);
      expect(logged).toHaveBeenCalledWith(expect.stringContaining(`Topic "${topic}" matches no handler`));
      expect(await offsetOf(groupId, topic, 0)).toBeLessThanOrEqual(0);
      await consumer.disconnect();
      clients.splice(clients.indexOf(consumer), 1);
      const recovered: string[] = [];
      const replacement = kafka.consumer({ kafkaJS: { groupId, fromBeginning: true } });
      clients.push(replacement);
      await replacement.connect();
      await replacement.subscribe({ topics: [topic] });
      await replacement.run({ eachMessage: async ({ message }) => { recovered.push(message.offset); } });
      await waitFor(() => recovered.length >= 2, WAIT_MS);
      expect(recovered).toEqual(['0', '1']);
    } finally {
      logged.mockRestore();
    }
  });
});
