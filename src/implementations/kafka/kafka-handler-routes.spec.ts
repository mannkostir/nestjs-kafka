import { KafkaHandlerRoutes } from './kafka-handler-routes.js';

const route = (handlerName: string) => ({ handlerName });

describe('KafkaHandlerRoutes', () => {
  it('routes a topic to the handler that claimed it', () => {
    const refunds = route('B.y');

    const routes = KafkaHandlerRoutes.claim('billing', [
      { topics: ['orders'], route: route('A.x') },
      { topics: ['refunds'], route: refunds },
    ]);

    expect(routes.resolve('refunds')).toEqual({ kind: 'owned', route: refunds });
  });

  it('rejects a topic claimed by two handlers, naming both and the topic', () => {
    expect(() =>
      KafkaHandlerRoutes.claim('billing', [
        { topics: ['orders'], route: route('A.x') },
        { topics: ['ns.orders', 'orders'], route: route('B.y') },
      ]),
    ).toThrow(
      'Message handlers A.x and B.y share group "billing" and both consume topic "orders". Each topic in a shared group must belong to exactly one handler.',
    );
  });

  it('lets one handler list the same topic twice', () => {
    const orders = route('A.x');

    const routes = KafkaHandlerRoutes.claim('billing', [{ topics: ['orders', 'orders'], route: orders }]);

    expect(routes.resolve('orders')).toEqual({ kind: 'owned', route: orders });
  });

  it('routes a topic matched by one pattern to its handler', () => {
    const audit = route('B.y');

    const routes = KafkaHandlerRoutes.claim('billing', [
      { topics: ['orders'], route: route('A.x') },
      { topics: [/^audit\..+/], route: audit },
    ]);

    expect(routes.resolve('audit.eu')).toEqual({ kind: 'owned', route: audit });
  });

  it('lets a concrete claim beat a pattern', () => {
    const special = route('A.x');

    const routes = KafkaHandlerRoutes.claim('billing', [
      { topics: [/^orders\..+/], route: route('B.y') },
      { topics: ['orders.special'], route: special },
    ]);

    expect(routes.resolve('orders.special')).toEqual({ kind: 'owned', route: special });
  });

  it('keeps a per-source retry topic with its concrete owner when a pattern also matches it', () => {
    const special = route('A.x');

    const routes = KafkaHandlerRoutes.claim('billing', [
      { topics: ['orders.special', 'orders.special.billing.retry.1'], route: special },
      { topics: [/^orders\..+/], route: route('B.y') },
    ]);

    expect(routes.resolve('orders.special.billing.retry.1')).toEqual({ kind: 'owned', route: special });
  });

  it('treats a topic matched by two patterns as unroutable, naming both handlers', () => {
    const routes = KafkaHandlerRoutes.claim('billing', [
      { topics: [/^orders\..+/], route: route('A.x') },
      { topics: [/^.*(created)/], route: route('B.y') },
    ]);

    expect(routes.resolve('orders.created')).toEqual({
      kind: 'unroutable',
      reason:
        'Topic "orders.created" matches the patterns of message handlers A.x and B.y in shared group "billing". ' +
        'Each topic in a shared group must belong to exactly one handler: rename the topic, narrow the patterns, ' +
        'or list the topic by name on the handler that should consume it.',
    });
  });

  it('treats a topic no handler claims as unroutable', () => {
    const routes = KafkaHandlerRoutes.claim('billing', [{ topics: ['orders'], route: route('A.x') }]);

    expect(routes.resolve('payments')).toEqual({
      kind: 'unroutable',
      reason: 'Topic "payments" matches no handler of shared group "billing".',
    });
  });

  it('matches POSIX bracket classes the way librdkafka does', () => {
    const audit = route('A.x');

    const routes = KafkaHandlerRoutes.claim('billing', [{ topics: [/^audit\.[[:digit:]]+$/], route: audit }]);

    expect(routes.resolve('audit.42')).toEqual({ kind: 'owned', route: audit });
  });

  it('rejects a pattern that cannot be translated, at claim time', () => {
    expect(() => KafkaHandlerRoutes.claim('billing', [{ topics: [/^[[:word:]]+$/], route: route('A.x') }])).toThrow(
      /is not a POSIX character class/,
    );
  });
});
