import { KafkaMessageJsonSerializeStrategy } from './kafka-message-json-serialize.strategy.js';

describe('KafkaMessageJsonSerializeStrategy', () => {
  const strategy = new KafkaMessageJsonSerializeStrategy();

  it('writes an object value as JSON without an envelope', async () => {
    expect(await strategy.serialize({ orderId: 'o-1' })).toBe('{"orderId":"o-1"}');
  });

  it('writes a string value as a JSON string', async () => {
    expect(await strategy.serialize('o-1')).toBe('"o-1"');
  });

  it('writes a null value as a record without a value', async () => {
    expect(await strategy.serialize(null)).toBeNull();
  });

  it('rejects an undefined value', async () => {
    await expect(strategy.serialize(undefined)).rejects.toThrow(
      'Message value of type undefined cannot be encoded as JSON. Send null for a record without a value.',
    );
  });

  it('rejects a function value', async () => {
    await expect(strategy.serialize(() => 1)).rejects.toThrow(
      'Message value of type function cannot be encoded as JSON. Send null for a record without a value.',
    );
  });
});
