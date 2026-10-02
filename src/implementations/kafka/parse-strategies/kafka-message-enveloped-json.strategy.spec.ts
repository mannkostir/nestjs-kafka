import type { KafkaJS } from '@confluentinc/kafka-javascript';
import { KafkaMessageEnvelopedJsonStrategy } from './kafka-message-enveloped-json.strategy.js';

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

const json = (value: unknown) => Buffer.from(JSON.stringify(value));

describe('KafkaMessageEnvelopedJsonStrategy', () => {
  const strategy = new KafkaMessageEnvelopedJsonStrategy();

  it('unwraps the payload of an envelope into the message value', async () => {
    const parsed = await strategy.parse(record(json({ payload: { orderId: 'o-1' } })));

    expect(parsed.value).toEqual({ orderId: 'o-1' });
  });

  it('decodes a payload that is itself a JSON-encoded string', async () => {
    const parsed = await strategy.parse(
      record(json({ payload: JSON.stringify({ orderId: 'o-1' }) })),
    );

    expect(parsed.value).toEqual({ orderId: 'o-1' });
  });

  it('throws when a string payload is not valid JSON', async () => {
    await expect(strategy.parse(record(json({ payload: 'not-json' })))).rejects.toThrow(
      /Failed to parse message payload as JSON/,
    );
  });

  it('exposes a null value for an envelope with a null payload', async () => {
    const parsed = await strategy.parse(record(json({ payload: null })));

    expect(parsed.value).toBeNull();
  });

  it('exposes a null value when the record carries no value', async () => {
    const parsed = await strategy.parse(record(null));

    expect(parsed.value).toBeNull();
  });

  it('rejects an object without a payload property', async () => {
    await expect(strategy.parse(record(json({ orderId: 'o-1' })))).rejects.toThrow(
      /Expected the message value to be a \{ payload \} envelope/,
    );
  });

  it('rejects an empty object', async () => {
    await expect(strategy.parse(record(json({})))).rejects.toThrow(
      /Expected the message value to be a \{ payload \} envelope/,
    );
  });

  it('rejects an array', async () => {
    await expect(strategy.parse(record(json([{ payload: 1 }])))).rejects.toThrow(
      /Expected the message value to be a \{ payload \} envelope/,
    );
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

  it('decodes the key the same lenient way as plain JSON', async () => {
    const parsed = await strategy.parse(record(json({ payload: 1 }), Buffer.from('order-1')));

    expect(parsed.key).toBe('order-1');
  });
});
