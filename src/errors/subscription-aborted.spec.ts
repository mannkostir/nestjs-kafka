import { SubscriptionAborted } from './subscription-aborted.js';

describe('SubscriptionAborted', () => {
  it('is named SubscriptionAborted', () => {
    expect(new SubscriptionAborted('dev-orders').name).toBe('SubscriptionAborted');
  });

  it('describes the group that stopped subscribing and why', () => {
    expect(new SubscriptionAborted('dev-orders').message).toBe(
      'Consumer group "dev-orders" stopped subscribing because the connector released its connections.',
    );
  });

  it('is an error', () => {
    expect(new SubscriptionAborted('dev-orders')).toBeInstanceOf(Error);
  });
});
