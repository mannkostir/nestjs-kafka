import { SourceRetryTopics } from './source-retry-topics.js';

describe('SourceRetryTopics', () => {
  it('names one retry topic per attempt for every source topic', () => {
    expect(SourceRetryTopics.for('orders-service', 2).allFor(['dev.orders.created', 'dev.orders.updated'])).toEqual([
      'dev.orders.created.orders-service.retry.1',
      'dev.orders.created.orders-service.retry.2',
      'dev.orders.updated.orders-service.retry.1',
      'dev.orders.updated.orders-service.retry.2',
    ]);
  });

  it('does not locate a source topic', () => {
    expect(SourceRetryTopics.for('svc', 3).locate('orders.created')).toBeUndefined();
  });

  it('locates a retry topic as its source and attempt', () => {
    expect(SourceRetryTopics.for('svc', 3).locate('orders.created.svc.retry.2')).toEqual({ source: 'orders.created', attempt: 2 });
  });

  it('does not locate a retry suffix beyond the configured attempts', () => {
    expect(SourceRetryTopics.for('svc', 3).locate('orders.created.svc.retry.4')).toBeUndefined();
  });

  it('does not locate a retry suffix of another group', () => {
    expect(SourceRetryTopics.for('svc', 3).locate('orders.created.other.retry.1')).toBeUndefined();
  });

  it.each(['orders.created.svc.retry.0', 'orders.created.svc.retry.01', 'orders.created.svc.retry.x', 'orders.created.svc.retry.'])(
    'does not locate %s',
    (topic) => {
      expect(SourceRetryTopics.for('svc', 3).locate(topic)).toBeUndefined();
    },
  );

  it('names the next retry topic of a failed delivery', () => {
    const topics = SourceRetryTopics.for('svc', 2);

    expect(topics.nextTopic({ source: 'orders.created', attempt: 1 })).toBe('orders.created.svc.retry.2');
  });

  it('has no next topic once the attempts are exhausted', () => {
    const topics = SourceRetryTopics.for('svc', 2);

    expect(topics.nextTopic({ source: 'orders.created', attempt: 2 })).toBeUndefined();
  });

  it.each([0, 1.5, Number.NaN])('rejects %p attempts', (attempts) => {
    expect(() => SourceRetryTopics.for('svc', attempts)).toThrow(
      `Invalid retry attempts: "attempts" (${attempts}) must be an integer greater than or equal to 1.`,
    );
  });

  it('rejects a groupId that cannot be part of a topic name', () => {
    expect(() => SourceRetryTopics.for('orders service', 1)).toThrow(/"orders service" contains characters other than/);
  });

  it('rejects a derived topic name longer than Kafka allows', () => {
    const source = 'a'.repeat(242);

    expect(() => SourceRetryTopics.for('svc', 1).allFor([source])).toThrow(/is 254 characters long/);
  });
});
