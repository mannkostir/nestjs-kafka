import { SubscriptionFailures } from './subscription-failures.js';

describe('SubscriptionFailures', () => {
  it('is named SubscriptionFailures', () => {
    expect(new SubscriptionFailures([], []).name).toBe('SubscriptionFailures');
  });

  it('is an error', () => {
    expect(new SubscriptionFailures([], [])).toBeInstanceOf(Error);
  });

  it('names every failed group by its handlers and group id with its cause', () => {
    const failures = new SubscriptionFailures(
      [
        {
          handlerNames: ['OrdersHandler.handle'],
          groupId: 'orders-service',
          cause: new Error('broker unavailable'),
        },
        {
          handlerNames: ['BillingHandler.a', 'BillingHandler.b'],
          groupId: 'billing',
          cause: new Error('join timed out'),
        },
      ],
      [],
    );

    expect(failures.message).toBe(
      'Failed to subscribe message handlers:\n' +
        '- OrdersHandler.handle (groupId "orders-service"): broker unavailable\n' +
        '- BillingHandler.a, BillingHandler.b (groupId "billing"): join timed out',
    );
  });

  it('lists aborted groups on one line after the failures', () => {
    const failures = new SubscriptionFailures(
      [
        {
          handlerNames: ['OrdersHandler.handle'],
          groupId: 'orders-service',
          cause: new Error('broker unavailable'),
        },
      ],
      [
        { handlerNames: ['PaymentsHandler.handle'], groupId: 'payments' },
        { handlerNames: ['RefundsHandler.handle'], groupId: 'refunds' },
      ],
    );

    expect(failures.message).toBe(
      'Failed to subscribe message handlers:\n' +
        '- OrdersHandler.handle (groupId "orders-service"): broker unavailable\n' +
        'Aborted after another handler failed: PaymentsHandler.handle (groupId "payments"), RefundsHandler.handle (groupId "refunds")',
    );
  });

  it('describes a cause that is not an error by its string form', () => {
    const failures = new SubscriptionFailures(
      [{ handlerNames: ['OrdersHandler.handle'], groupId: 'orders-service', cause: 'refused' }],
      [],
    );

    expect(failures.message).toBe(
      'Failed to subscribe message handlers:\n' +
        '- OrdersHandler.handle (groupId "orders-service"): refused',
    );
  });

  it('carries the cause of every failed group', () => {
    const cause = new Error('broker unavailable');
    const failures = new SubscriptionFailures(
      [{ handlerNames: ['OrdersHandler.handle'], groupId: 'orders-service', cause }],
      [],
    );

    expect(failures.failures.map((failure) => failure.cause)).toEqual([cause]);
  });
});
