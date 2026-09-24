import { KafkaMessage as KafkaJSMessage } from 'kafkajs';
import { KafkaMessageJsonStrategy } from './kafka-message-json.strategy';

type Payload = { orderId: string };

const record = (
  value: Buffer | null,
  key: Buffer | null = null,
): KafkaJSMessage => ({
  key,
  value,
  timestamp: '0',
  size: 0,
  attributes: 0,
  offset: '0',
});

describe('KafkaMessageJsonStrategy', () => {
  const strategy = new KafkaMessageJsonStrategy<Payload>();

  it('parses a JSON envelope into the message value', async () => {
    const message = record(
      Buffer.from(JSON.stringify({ payload: { orderId: 'o-1' } })),
    );

    const parsed = await strategy.parse(message);

    expect(parsed.value?.payload).toEqual({ orderId: 'o-1' });
  });

  it('exposes a null value when the record carries no value', async () => {
    const parsed = await strategy.parse(record(null));

    expect(parsed.value).toBeNull();
  });

  it('throws when the value is not valid JSON', async () => {
    const message = record(Buffer.from('not-json'));

    await expect(strategy.parse(message)).rejects.toThrow(
      /Failed to parse message value as JSON/,
    );
  });

  it('decodes a payload that is itself a JSON-encoded string', async () => {
    const message = record(
      Buffer.from(JSON.stringify({ payload: JSON.stringify({ orderId: 'o-1' }) })),
    );

    const parsed = await strategy.parse(message);

    expect(parsed.value?.payload).toEqual({ orderId: 'o-1' });
  });

  it('throws a descriptive error when a string payload is not valid JSON', async () => {
    const message = record(
      Buffer.from(JSON.stringify({ payload: 'not-json' })),
    );

    await expect(strategy.parse(message)).rejects.toThrow(
      /Failed to parse message payload as JSON/,
    );
  });

  it('decodes a JSON-encoded key', async () => {
    const message = record(
      Buffer.from(JSON.stringify({ payload: { orderId: 'o-1' } })),
      Buffer.from(JSON.stringify({ tenant: 'acme' })),
    );

    const parsed = await strategy.parse(message);

    expect(parsed.key).toEqual({ tenant: 'acme' });
  });

  it('decodes a plain string key that is not valid JSON', async () => {
    const message = record(
      Buffer.from(JSON.stringify({ payload: { orderId: 'o-1' } })),
      Buffer.from('order-1'),
    );

    const parsed = await strategy.parse(message);

    expect(parsed.key).toBe('order-1');
  });

  it('exposes a null key when the record carries no key', async () => {
    const message = record(
      Buffer.from(JSON.stringify({ payload: { orderId: 'o-1' } })),
    );

    const parsed = await strategy.parse(message);

    expect(parsed.key).toBeNull();
  });
});
