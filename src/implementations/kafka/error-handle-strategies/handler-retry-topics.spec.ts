import type { KafkaJS } from '@confluentinc/kafka-javascript';
import { GroupRetryTopics } from './group-retry-topics.js';
import { HandlerRetryTopics } from './handler-retry-topics.js';
import { SourceRetryTopics } from './source-retry-topics.js';

const message = (originalTopic?: string) =>
  ({ headers: originalTopic ? { 'retry.original.topic': originalTopic } : {} }) as unknown as KafkaJS.KafkaMessage;

const mixed = () =>
  new HandlerRetryTopics(SourceRetryTopics.for('svc', 2), new Set(['orders.created']), GroupRetryTopics.for('svc', 2));

describe('HandlerRetryTopics', () => {
  it('locates a source topic as attempt zero', () => {
    expect(mixed().locate('audit.eu', message())).toEqual({ source: 'audit.eu', attempt: 0 });
  });

  it('locates a per-source retry topic by its name', () => {
    expect(mixed().locate('orders.created.svc.retry.1', message())).toEqual({ source: 'orders.created', attempt: 1 });
  });

  it('locates a group retry topic by its header', () => {
    expect(mixed().locate('svc.retry.1', message('audit.eu'))).toEqual({ source: 'audit.eu', attempt: 1 });
  });

  it('sends a concrete source to its per-source retry topic', () => {
    expect(mixed().nextTopic({ source: 'orders.created', attempt: 0 })).toBe('orders.created.svc.retry.1');
  });

  it('sends a pattern source to the group retry topic', () => {
    expect(mixed().nextTopic({ source: 'audit.eu', attempt: 1 })).toBe('svc.retry.2');
  });

  it('keeps a concrete source on the per-source scheme even when a pattern matches it', () => {
    expect(mixed().nextTopic({ source: 'orders.created', attempt: 1 })).toBe('orders.created.svc.retry.2');
  });

  it('uses the per-source scheme for every source without a group scheme', () => {
    const topics = new HandlerRetryTopics(SourceRetryTopics.for('svc', 2), new Set());

    expect(topics.nextTopic({ source: 'orders.created', attempt: 0 })).toBe('orders.created.svc.retry.1');
  });

  it.each([
    ['orders.created.svc.retry.1', true],
    ['svc.retry.2', true],
    ['audit.eu', false],
  ])('recognises %s as a retry topic: %s', (topic, expected) => {
    expect(mixed().isRetryTopic(topic)).toBe(expected);
  });

  it('lists the per-source retry topics of the concrete sources', () => {
    expect(mixed().perSourceTopics(['orders.created'])).toEqual(['orders.created.svc.retry.1', 'orders.created.svc.retry.2']);
  });

  it('lists the group retry topics', () => {
    expect(mixed().groupTopics()).toEqual(['svc.retry.1', 'svc.retry.2']);
  });

  it('lists no group retry topics without a group scheme', () => {
    expect(new HandlerRetryTopics(SourceRetryTopics.for('svc', 2), new Set()).groupTopics()).toEqual([]);
  });
});
