import type { KafkaJS } from '@confluentinc/kafka-javascript';
import type { Logger } from '@nestjs/common';
import { KafkaHandlerRoutes } from './kafka-handler-routes.js';
import { KafkaSharedGroupDispatcher } from './kafka-shared-group-dispatcher.js';

const stubLogger = () => ({ error: jest.fn() }) as unknown as Logger & { error: jest.Mock };

const record = (offset: string, originalTopic?: string) =>
  ({
    offset,
    headers: originalTopic ? { 'retry.original.topic': originalTopic } : {},
  }) as unknown as KafkaJS.KafkaMessage;

const payloadOn = (topic: string, messages: KafkaJS.KafkaMessage[]) =>
  ({
    batch: { topic, partition: 3, messages },
    isRunning: () => true,
    isStale: () => false,
    resolveOffset: jest.fn(),
    pause: jest.fn(() => jest.fn()),
  }) as unknown as KafkaJS.EachBatchPayload & { resolveOffset: jest.Mock; pause: jest.Mock };

const resolvingRoute = (handlerName: string) => ({
  handlerName,
  eachBatch: jest.fn(async (payload: KafkaJS.EachBatchPayload) => {
    payload.batch.messages.forEach((message) => payload.resolveOffset(message.offset));
  }),
});

const holdingRoute = (handlerName: string) => ({
  handlerName,
  eachBatch: jest.fn(async () => undefined),
});

type TestRoute = ReturnType<typeof resolvingRoute>;

const dispatcherFor = (orders: TestRoute, audit: TestRoute, logger = stubLogger()) =>
  new KafkaSharedGroupDispatcher(
    KafkaHandlerRoutes.claim('billing', [
      { topics: ['orders.created'], route: orders },
      { topics: [/^audit\..+/, /^.*(eu)/], route: audit },
    ]),
    new Set(['billing.retry.1']),
    logger,
  );

describe('KafkaSharedGroupDispatcher', () => {
  it('hands a batch to the handler that owns its topic', async () => {
    const orders = resolvingRoute('A.x');
    const payload = payloadOn('orders.created', [record('1')]);

    await dispatcherFor(orders, resolvingRoute('B.y')).dispatch(payload);

    expect(orders.eachBatch).toHaveBeenCalledWith(payload);
  });

  it('pauses an unroutable partition without resolving it', async () => {
    const payload = payloadOn('payments', [record('1')]);

    await dispatcherFor(resolvingRoute('A.x'), resolvingRoute('B.y')).dispatch(payload);

    expect([payload.pause.mock.calls.length, payload.resolveOffset.mock.calls.length]).toEqual([1, 0]);
  });

  it('logs why a partition is paused', async () => {
    const logger = stubLogger();

    await dispatcherFor(resolvingRoute('A.x'), resolvingRoute('B.y'), logger).dispatch(payloadOn('payments', [record('1')]));

    expect(logger.error).toHaveBeenCalledWith(
      'Topic "payments" matches no handler of shared group "billing". Partition 3 of "payments" is paused until the next rebalance.',
    );
  });

  it('pauses again on a later batch of the same unroutable topic', async () => {
    const dispatcher = dispatcherFor(resolvingRoute('A.x'), resolvingRoute('B.y'));
    const later = payloadOn('payments', [record('2')]);

    await dispatcher.dispatch(payloadOn('payments', [record('1')]));
    await dispatcher.dispatch(later);

    expect(later.pause).toHaveBeenCalledTimes(1);
  });

  it('routes shared retry records by their original topic, in runs', async () => {
    const orders = resolvingRoute('A.x');
    const audit = resolvingRoute('B.y');
    const payload = payloadOn('billing.retry.1', [record('1', 'audit.us'), record('2', 'audit.us'), record('3', 'orders.created')]);

    await dispatcherFor(orders, audit).dispatch(payload);

    expect([
      audit.eachBatch.mock.calls[0][0].batch.messages.map((message: KafkaJS.KafkaMessage) => message.offset),
      orders.eachBatch.mock.calls[0][0].batch.messages.map((message: KafkaJS.KafkaMessage) => message.offset),
    ]).toEqual([['1', '2'], ['3']]);
  });

  it('resolves shared retry records on the real payload', async () => {
    const payload = payloadOn('billing.retry.1', [record('1', 'audit.us'), record('2', 'orders.created')]);

    await dispatcherFor(resolvingRoute('A.x'), resolvingRoute('B.y')).dispatch(payload);

    expect(payload.resolveOffset.mock.calls.map(([offset]) => offset)).toEqual(['1', '2']);
  });

  it('stops at a held record so no later record is resolved past it', async () => {
    const orders = resolvingRoute('A.x');
    const audit = holdingRoute('B.y') as unknown as TestRoute;
    const payload = payloadOn('billing.retry.1', [record('1', 'audit.us'), record('2', 'orders.created')]);

    await dispatcherFor(orders, audit).dispatch(payload);

    expect([orders.eachBatch.mock.calls.length, payload.resolveOffset.mock.calls.length]).toEqual([0, 0]);
  });

  it('pauses a shared retry partition at a record without an original topic', async () => {
    const orders = resolvingRoute('A.x');
    const payload = payloadOn('billing.retry.1', [record('1', 'orders.created'), record('2')]);

    await dispatcherFor(orders, resolvingRoute('B.y')).dispatch(payload);

    expect([payload.resolveOffset.mock.calls.map(([offset]) => offset), payload.pause.mock.calls.length]).toEqual([['1'], 1]);
  });

  it('pauses a shared retry partition at a record whose original topic two patterns match', async () => {
    const logger = stubLogger();
    const payload = payloadOn('billing.retry.1', [record('1', 'audit.eu')]);
    const dispatcher = new KafkaSharedGroupDispatcher(
      KafkaHandlerRoutes.claim('billing', [
        { topics: [/^audit\..+/], route: resolvingRoute('A.x') },
        { topics: [/^.*(eu)/], route: resolvingRoute('B.y') },
      ]),
      new Set(['billing.retry.1']),
      logger,
    );

    await dispatcher.dispatch(payload);

    expect(payload.pause).toHaveBeenCalledTimes(1);
  });

  it('propagates a handler error', async () => {
    const failing = { handlerName: 'A.x', eachBatch: jest.fn().mockRejectedValue(new Error('boom')) };

    await expect(
      dispatcherFor(failing as unknown as TestRoute, resolvingRoute('B.y')).dispatch(payloadOn('orders.created', [record('1')])),
    ).rejects.toThrow('boom');
  });
});
