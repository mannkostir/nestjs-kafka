import { KafkaHandlerRoutes } from './kafka-handler-routes.js';

const route = (handlerName: string) => ({ handlerName });

describe('KafkaHandlerRoutes', () => {
  it('routes a topic to the handler that claimed it', () => {
    const orders = route('A.x');
    const refunds = route('B.y');

    const routes = KafkaHandlerRoutes.claim('billing', [
      { topics: ['orders'], route: orders },
      { topics: ['refunds'], route: refunds },
    ]);

    expect(routes.handlerFor('refunds')).toBe(refunds);
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

    expect(routes.handlerFor('orders')).toBe(orders);
  });

  it('rejects a RegExp claim, naming the handler', () => {
    expect(() =>
      KafkaHandlerRoutes.claim('billing', [{ topics: [/orders\..*/], route: route('A.x') }]),
    ).toThrow(
      'Message handler A.x subscribes to a RegExp pattern in shared group "billing". Handlers in a shared group must list concrete topic names.',
    );
  });

  it('throws naming a topic no handler claimed', () => {
    const routes = KafkaHandlerRoutes.claim('billing', [{ topics: ['orders'], route: route('A.x') }]);

    expect(() => routes.handlerFor('payments')).toThrow(
      'Received a batch from topic "payments", which no handler of shared group "billing" consumes.',
    );
  });
});
