import { LibrdkafkaTopicPattern } from './librdkafka-topic-pattern.js';
import { TopicNamespacer } from './topic-namespacer.js';

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

describe('LibrdkafkaTopicPattern.matcher', () => {
  it.each([
    [/^orders\.[[:alnum:]_-]+$/, 'orders.v2_x-y', true],
    [/^orders\.[[:alnum:]_-]+$/, 'orders.v2.x', false],
    [/^[[:digit:]]+$/, '123', true],
    [/^[[:digit:]]+$/, '12a', false],
    [/^[[:upper:]][[:lower:]]+$/, 'Orders', true],
    [/^[[:alpha:]]+$/, 'orders1', false],
    [/^[[:xdigit:]]+$/, 'beef09', true],
    [/^a[[:punct:]]b$/, 'a.b', true],
    [/^a[[:punct:]]b$/, 'a1b', false],
    [/^a[]b]c$/, 'a]c', true],
    [/^a[^]b]c$/, 'a]c', false],
    [/^a[^]b]c$/, 'axc', true],
    [/^a[\.]c$/, 'a\\c', true],
    [/^a[\.]c$/, 'a.c', true],
    [/^orders\.(created|updated)$/, 'orders.updated', true],
    [/^orders\.[a-z]{2,3}$/, 'orders.abcd', false],
  ])('translates %s so that %s matches: %s', (pattern, topic, matches) => {
    expect(LibrdkafkaTopicPattern.matcher(pattern).test(topic)).toBe(matches);
  });

  it('keeps the substring semantics of an anchored unanchored pattern', () => {
    const matcher = LibrdkafkaTopicPattern.matcher(LibrdkafkaTopicPattern.anchor(/orders/) as RegExp);

    expect(matcher.test('eu.orders.created')).toBe(true);
  });

  it('matches a namespaced pattern only inside its namespace', () => {
    const namespaced = new TopicNamespacer('dev').applyPattern(/orders\.[[:alnum:]]+/) as RegExp;
    const matcher = LibrdkafkaTopicPattern.matcher(namespaced);

    expect([matcher.test('dev.orders.x1'), matcher.test('prod.orders.x1')]).toEqual([true, false]);
  });

  it('rejects a bracket class that is not a POSIX class', () => {
    expect(() => LibrdkafkaTopicPattern.matcher(/^[[:word:]]+$/)).toThrow(
      'Topic pattern /^[[:word:]]+$/ uses [:word:], which is not a POSIX character class.',
    );
  });

  it.each([/^[[.a.]]$/, /^[[=a=]]$/])('rejects collating elements and equivalence classes in %s', (pattern) => {
    expect(() => LibrdkafkaTopicPattern.matcher(pattern)).toThrow(
      /collating elements and equivalence classes are not supported/,
    );
  });

  it('rejects a POSIX class that is never closed', () => {
    expect(() => LibrdkafkaTopicPattern.matcher(/^[[:alnum]$/)).toThrow(/unterminated bracket expression/);
  });
});
