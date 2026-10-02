import { KafkaMessageJsonSerializeStrategy } from './kafka-message-json-serialize.strategy.js';

describe('KafkaMessageJsonSerializeStrategy', () => {
  const strategy = new KafkaMessageJsonSerializeStrategy();

  it('writes an object value as JSON without an envelope', () => {
    expect(strategy.serialize({ orderId: 'o-1' })).toBe('{"orderId":"o-1"}');
  });

  it('writes a string value as a JSON string', () => {
    expect(strategy.serialize('o-1')).toBe('"o-1"');
  });

  it('writes a null value as a record without a value', () => {
    expect(strategy.serialize(null)).toBeNull();
  });

  it('rejects an undefined value', () => {
    expect(() => strategy.serialize(undefined)).toThrow(
      'Message value of type undefined cannot be encoded as JSON. Send null for a record without a value.',
    );
  });

  it('rejects a function value', () => {
    expect(() => strategy.serialize(() => 1)).toThrow(
      'Message value of type function cannot be encoded as JSON. Send null for a record without a value.',
    );
  });
});
