import { LibrdkafkaTopicPattern } from './librdkafka-topic-pattern.js';

describe('LibrdkafkaTopicPattern accepts', () => {
  it('returns a string topic unchanged', () => {
    expect(LibrdkafkaTopicPattern.normalize('orders')).toBe('orders');
  });

  it.each([
    /^dev\.(orders|payments)/,
    /^v[0-9]+/,
    /^a\(?b/,
    /^[(?]x/,
    /^orders\..*$/,
  ])('returns the supported anchored pattern %s unchanged', (pattern) => {
    expect(LibrdkafkaTopicPattern.normalize(pattern)).toBe(pattern);
  });

  it('anchors an unanchored pattern so it matches anywhere in the topic', () => {
    const result = LibrdkafkaTopicPattern.normalize(/orders|payments/) as RegExp;

    expect(result.source).toBe('^.*(orders|payments)');
  });
});

describe('LibrdkafkaTopicPattern rejects', () => {
  it.each([
    [/^orders/i, /flags "i" are not supported/],
    [/^(?:a|b)/, /groups starting with \(\?/],
    [/^a(?=b)/, /groups starting with \(\?/],
    [/^a.*?/, /lazy quantifiers are not supported/],
    [/^v\d+/, /escape \\d is not portable/],
    [/^\w+/, /escape \\w is not portable/],
  ])('%s', (pattern, message) => {
    expect(() => LibrdkafkaTopicPattern.normalize(pattern)).toThrow(message);
  });

  it('names the pattern and how to write a supported one', () => {
    expect(() => LibrdkafkaTopicPattern.normalize(/^orders/i)).toThrow(
      /Topic pattern \/\^orders\/i cannot be subscribed: .*POSIX extended regular expressions/,
    );
  });
});
