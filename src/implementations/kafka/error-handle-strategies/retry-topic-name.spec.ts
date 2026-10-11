import { RetryTopicName } from './retry-topic-name.js';

describe('RetryTopicName', () => {
  it.each([0, 1.5, Number.NaN])('rejects %p attempts', (attempts) => {
    expect(() => RetryTopicName.assertRetryable('svc', attempts)).toThrow(
      `Invalid retry attempts: "attempts" (${attempts}) must be an integer greater than or equal to 1.`,
    );
  });

  it('rejects a groupId that cannot be part of a topic name', () => {
    expect(() => RetryTopicName.assertRetryable('orders service', 1)).toThrow(/"orders service" contains characters other than/);
  });

  it('rejects a topic name longer than Kafka allows', () => {
    expect(() => RetryTopicName.checked('a'.repeat(250))).toThrow(/is 250 characters long/);
  });

  it('reads an attempt within the configured attempts', () => {
    expect(RetryTopicName.attemptOf('2', 3)).toBe(2);
  });

  it.each(['0', '01', 'x', '', '4'])('reads no attempt from suffix %p', (suffix) => {
    expect(RetryTopicName.attemptOf(suffix, 3)).toBeUndefined();
  });
});
