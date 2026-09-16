import { TopicNamespacer } from './topic-namespacer';

describe('TopicNamespacer without a namespace', () => {
  const namespacer = new TopicNamespacer();

  it('returns the topic unchanged', () => {
    expect(namespacer.apply('orders.created')).toBe('orders.created');
  });

  it('returns the pattern unchanged', () => {
    const pattern = /^orders\..*/;

    expect(namespacer.applyPattern(pattern)).toBe(pattern);
  });
});

describe('TopicNamespacer with a namespace', () => {
  const namespacer = new TopicNamespacer('dev');

  it('prefixes a string topic', () => {
    expect(namespacer.apply('orders.created')).toBe('dev.orders.created');
  });

  it('prefixes unconditionally, without detecting an existing prefix', () => {
    expect(namespacer.apply('dev.orders.created')).toBe(
      'dev.dev.orders.created',
    );
  });

  it('prefixes a string passed to applyPattern', () => {
    expect(namespacer.applyPattern('orders.created')).toBe(
      'dev.orders.created',
    );
  });

  it('inserts the prefix after a leading anchor', () => {
    const result = namespacer.applyPattern(/^orders\..*/) as RegExp;

    expect(result.source).toBe('^dev\\.(?:orders\\..*)');
    expect(result.test('dev.orders.created')).toBe(true);
    expect(result.test('orders.created')).toBe(false);
    expect(result.test('prod.orders.created')).toBe(false);
  });

  it('anchors an unanchored pattern inside the namespace', () => {
    const result = namespacer.applyPattern(/orders\.\w+/) as RegExp;

    expect(result.source).toBe('^dev\\..*(?:orders\\.\\w+)');
    expect(result.test('dev.orders.created')).toBe(true);
    expect(result.test('dev.eu.orders.created')).toBe(true);
    expect(result.test('prod.orders.created')).toBe(false);
  });

  it('confines a top level alternation to the namespace', () => {
    const result = namespacer.applyPattern(/^orders|payments/) as RegExp;

    expect(result.source).toBe('^dev\\.(?:orders|payments)');
    expect(result.test('dev.payments')).toBe(true);
    expect(result.test('payments')).toBe(false);
    expect(result.test('prod.payments')).toBe(false);
  });

  it('preserves regular expression flags', () => {
    const result = namespacer.applyPattern(/^orders/i) as RegExp;

    expect(result.flags).toBe('i');
  });

  it('preserves capture group numbering', () => {
    const result = namespacer.applyPattern(/^(orders)\.(\w+)/) as RegExp;
    const match = result.exec('dev.orders.created');

    expect(match?.[1]).toBe('orders');
    expect(match?.[2]).toBe('created');
  });
});

describe('TopicNamespacer with a namespace containing regex metacharacters', () => {
  const namespacer = new TopicNamespacer('d.v');

  it('escapes the namespace before inserting it into a pattern', () => {
    const result = namespacer.applyPattern(/^orders\..*/) as RegExp;

    expect(result.test('d.v.orders.created')).toBe(true);
    expect(result.test('dXv.orders.created')).toBe(false);
  });
});
