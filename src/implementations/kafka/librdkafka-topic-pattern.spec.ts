import { LibrdkafkaTopicPattern } from './librdkafka-topic-pattern.js';

describe('LibrdkafkaTopicPattern validate accepts', () => {
  it.each([
    'orders',
    'orders.^archive',
    /^dev\.(orders|payments)/,
    /^v[0-9]+/,
    /^a\(?b/,
    /^[(?]x/,
    /^orders\..*$/,
    /orders|payments/,
  ])('%s', (pattern) => {
    expect(() => LibrdkafkaTopicPattern.validate(pattern)).not.toThrow();
  });
});

describe('LibrdkafkaTopicPattern validate rejects', () => {
  it.each([
    [/^orders/i, /flags "i" are not supported/],
    [/^(?:a|b)/, /groups starting with \(\?/],
    [/^a(?=b)/, /groups starting with \(\?/],
    [/^a.*?/, /lazy quantifiers are not supported/],
    [/^v\d+/, /escape \\d is not portable/],
    [/^\w+/, /escape \\w is not portable/],
  ])('%s', (pattern, message) => {
    expect(() => LibrdkafkaTopicPattern.validate(pattern)).toThrow(message);
  });

  it('names the pattern and how to write a supported one', () => {
    expect(() => LibrdkafkaTopicPattern.validate(/^orders/i)).toThrow(
      /Topic pattern \/\^orders\/i cannot be subscribed: .*POSIX extended regular expressions/,
    );
  });

  it('a string topic starting with ^, which librdkafka would match as a regular expression', () => {
    expect(() => LibrdkafkaTopicPattern.validate('^orders')).toThrow(
      'Topic "^orders" cannot be subscribed: librdkafka matches a topic starting with ^ as a regular expression. ' +
      'Pass a RegExp instead, for example /^orders/.',
    );
  });
});

describe('LibrdkafkaTopicPattern anchor', () => {
  it('returns a string topic unchanged', () => {
    expect(LibrdkafkaTopicPattern.anchor('orders')).toBe('orders');
  });

  it('returns an anchored pattern unchanged', () => {
    const pattern = /^dev\.(orders|payments)/;

    expect(LibrdkafkaTopicPattern.anchor(pattern)).toBe(pattern);
  });

  it('anchors an unanchored pattern so it matches anywhere in the topic', () => {
    const result = LibrdkafkaTopicPattern.anchor(/orders|payments/) as RegExp;

    expect(result.source).toBe('^.*(orders|payments)');
  });
});
