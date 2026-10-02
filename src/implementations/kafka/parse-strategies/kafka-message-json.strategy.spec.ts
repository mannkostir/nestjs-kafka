import type { KafkaJS } from '@confluentinc/kafka-javascript';
import { KafkaMessageJsonStrategy } from './kafka-message-json.strategy.js';

const record = (
  value: Buffer | null,
  key: Buffer | null = null,
): KafkaJS.KafkaMessage => ({
  key,
  value,
  timestamp: '0',
  size: 0,
  attributes: 0,
  offset: '0',
});

const recordWithHeaders = (headers: KafkaJS.IHeaders): KafkaJS.KafkaMessage => ({
  key: null,
  value: Buffer.from('{}'),
  timestamp: '0',
  attributes: 0,
  offset: '0',
  headers,
});

describe('KafkaMessageJsonStrategy', () => {
  const strategy = new KafkaMessageJsonStrategy();

  it('passes a JSON object value to the message as-is', async () => {
    const parsed = await strategy.parse(record(Buffer.from(JSON.stringify({ orderId: 'o-1' }))));

    expect(parsed.value).toEqual({ orderId: 'o-1' });
  });

  it('does not unwrap a payload property', async () => {
    const parsed = await strategy.parse(
      record(Buffer.from(JSON.stringify({ payload: { orderId: 'o-1' } }))),
    );

    expect(parsed.value).toEqual({ payload: { orderId: 'o-1' } });
  });

  it('does not parse a string payload property again', async () => {
    const parsed = await strategy.parse(
      record(Buffer.from(JSON.stringify({ payload: JSON.stringify({ orderId: 'o-1' }) }))),
    );

    expect(parsed.value).toEqual({ payload: '{"orderId":"o-1"}' });
  });

  it('passes a JSON array value as-is', async () => {
    const parsed = await strategy.parse(record(Buffer.from('[1,2,3]')));

    expect(parsed.value).toEqual([1, 2, 3]);
  });

  it('passes a JSON number value as-is', async () => {
    const parsed = await strategy.parse(record(Buffer.from('42')));

    expect(parsed.value).toBe(42);
  });

  it('keeps a JSON string value as a string without parsing it again', async () => {
    const parsed = await strategy.parse(
      record(Buffer.from(JSON.stringify(JSON.stringify({ orderId: 'o-1' })))),
    );

    expect(parsed.value).toBe('{"orderId":"o-1"}');
  });

  it('exposes a null value when the record carries no value', async () => {
    const parsed = await strategy.parse(record(null));

    expect(parsed.value).toBeNull();
  });

  it('exposes a null value when the record value is the JSON literal null', async () => {
    const parsed = await strategy.parse(record(Buffer.from('null')));

    expect(parsed.value).toBeNull();
  });

  it('throws when the value is not valid JSON', async () => {
    await expect(strategy.parse(record(Buffer.from('not-json')))).rejects.toThrow(
      /Failed to parse message value as JSON/,
    );
  });

  it('decodes a JSON-encoded key', async () => {
    const parsed = await strategy.parse(
      record(Buffer.from('{}'), Buffer.from(JSON.stringify({ tenant: 'acme' }))),
    );

    expect(parsed.key).toEqual({ tenant: 'acme' });
  });

  it('decodes a plain string key that is not valid JSON', async () => {
    const parsed = await strategy.parse(record(Buffer.from('{}'), Buffer.from('order-1')));

    expect(parsed.key).toBe('order-1');
  });

  it('keeps a key that reads as a JSON number as a string', async () => {
    const parsed = await strategy.parse(record(Buffer.from('{}'), Buffer.from('42')));

    expect(parsed.key).toBe('42');
  });

  it('keeps a key that reads as the JSON literal null as a string', async () => {
    const parsed = await strategy.parse(record(Buffer.from('{}'), Buffer.from('null')));

    expect(parsed.key).toBe('null');
  });

  it('keeps a key that reads as a JSON array as a string', async () => {
    const parsed = await strategy.parse(record(Buffer.from('{}'), Buffer.from('[1]')));

    expect(parsed.key).toBe('[1]');
  });

  it('keeps an empty key as an empty string rather than null', async () => {
    const parsed = await strategy.parse(record(Buffer.from('{}'), Buffer.from('')));

    expect(parsed.key).toBe('');
  });

  it('exposes a null key when the record carries no key', async () => {
    const parsed = await strategy.parse(record(Buffer.from('{}')));

    expect(parsed.key).toBeNull();
  });

  describe('headers', () => {
    it('decodes a Buffer header value as a UTF-8 string', async () => {
      const parsed = await strategy.parse(
        recordWithHeaders({ 'x-correlation-id': Buffer.from('c-1') }),
      );

      expect(parsed.headers).toEqual({ 'x-correlation-id': 'c-1' });
    });

    it('keeps a string header value as it is', async () => {
      const parsed = await strategy.parse(recordWithHeaders({ 'x-source': 'billing' }));

      expect(parsed.headers).toEqual({ 'x-source': 'billing' });
    });

    it('decodes every value of a repeated header in order', async () => {
      const parsed = await strategy.parse(
        recordWithHeaders({ 'x-tag': [Buffer.from('a'), 'b', Buffer.from('c')] }),
      );

      expect(parsed.headers).toEqual({ 'x-tag': ['a', 'b', 'c'] });
    });

    it('drops a header whose value is undefined', async () => {
      const parsed = await strategy.parse(
        recordWithHeaders({ 'x-present': 'yes', 'x-absent': undefined }),
      );

      expect(parsed.headers).toEqual({ 'x-present': 'yes' });
    });

    it('decodes invalid UTF-8 header bytes with replacement characters', async () => {
      const parsed = await strategy.parse(
        recordWithHeaders({ 'x-binary': Buffer.from([0x61, 0xff]) }),
      );

      expect(parsed.headers).toEqual({ 'x-binary': 'a�' });
    });

    it('carries empty headers when the record has none', async () => {
      const parsed = await strategy.parse(record(Buffer.from('{}')));

      expect(parsed.headers).toEqual({});
    });
  });

  it('rejects a record whose value is empty bytes', async () => {
    await expect(strategy.parse(record(Buffer.alloc(0)))).rejects.toThrow(
      /Failed to parse message value as JSON/,
    );
  });
});
