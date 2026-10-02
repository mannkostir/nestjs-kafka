import { KafkaMessageEnvelopedJsonSerializeStrategy } from './kafka-message-enveloped-json-serialize.strategy.js';

describe('KafkaMessageEnvelopedJsonSerializeStrategy', () => {
  const strategy = new KafkaMessageEnvelopedJsonSerializeStrategy();

  it('wraps the value in a payload envelope', () => {
    expect(strategy.serialize({ orderId: 'o-1' })).toBe('{"payload":{"orderId":"o-1"}}');
  });

  it('writes the same bytes as stringifying the envelope', () => {
    const value = { orderId: 'o-1', lines: [1, 2], note: 'a "quoted" word' };

    expect(strategy.serialize(value)).toBe(JSON.stringify({ payload: value }));
  });

  it('writes a string value encoded a second time', () => {
    expect(strategy.serialize('hello')).toBe('{"payload":"\\"hello\\""}');
  });

  it('wraps a null value in an envelope with a null payload', () => {
    expect(strategy.serialize(null)).toBe('{"payload":null}');
  });

  it('rejects an undefined value', () => {
    expect(() => strategy.serialize(undefined)).toThrow(
      'Message value of type undefined cannot be encoded as JSON. Send null for a record without a value.',
    );
  });
});
