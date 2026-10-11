import type { KafkaJS } from '@confluentinc/kafka-javascript';
import { GroupRetryTopics } from './group-retry-topics.js';

const withHeaders = (headers?: KafkaJS.IHeaders) => ({ headers }) as unknown as KafkaJS.KafkaMessage;

describe('GroupRetryTopics', () => {
  it('names one topic per attempt after the group', () => {
    expect(GroupRetryTopics.for('dev-svc', 2).all()).toEqual(['dev-svc.retry.1', 'dev-svc.retry.2']);
  });

  it('locates a group retry record by its attempt and original topic header', () => {
    expect(
      GroupRetryTopics.for('svc', 3).locate('svc.retry.2', withHeaders({ 'retry.original.topic': 'audit.eu' })),
    ).toEqual({ source: 'audit.eu', attempt: 2 });
  });

  it('falls back to the retry topic as the source when the header is missing', () => {
    expect(GroupRetryTopics.for('svc', 3).locate('svc.retry.1', withHeaders())).toEqual({ source: 'svc.retry.1', attempt: 1 });
  });

  it.each(['orders.svc.retry.1', 'svc.retry.4', 'other.retry.1', 'svc.retry.x'])('does not locate %s', (topic) => {
    expect(GroupRetryTopics.for('svc', 3).locate(topic, withHeaders())).toBeUndefined();
  });

  it('names the next group retry topic', () => {
    expect(GroupRetryTopics.for('svc', 2).nextTopic({ source: 'audit.eu', attempt: 1 })).toBe('svc.retry.2');
  });

  it('has no next topic once the attempts are exhausted', () => {
    expect(GroupRetryTopics.for('svc', 2).nextTopic({ source: 'audit.eu', attempt: 2 })).toBeUndefined();
  });

  it('rejects a groupId that cannot be part of a topic name', () => {
    expect(() => GroupRetryTopics.for('svc one', 1)).toThrow(/"svc one" contains characters other than/);
  });

  it('rejects a group retry topic longer than Kafka allows', () => {
    expect(() => GroupRetryTopics.for('g'.repeat(242), 1).all()).toThrow(/characters long/);
  });
});
