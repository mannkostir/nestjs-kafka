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

  it('exposes a null key when the record carries no key', async () => {
    const parsed = await strategy.parse(record(Buffer.from('{}')));

    expect(parsed.key).toBeNull();
  });
});
