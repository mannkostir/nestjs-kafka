import type { KafkaJS } from '@confluentinc/kafka-javascript';
import { KafkaMessageEnvelopedJsonSerializeStrategy } from './serialize-strategies/kafka-message-enveloped-json-serialize.strategy.js';
import { KafkaMessageEnvelopedJsonStrategy } from './parse-strategies/kafka-message-enveloped-json.strategy.js';

const record = (value: Buffer): KafkaJS.KafkaMessage => ({
  key: null,
  value,
  timestamp: '0',
  size: 0,
  attributes: 0,
  offset: '0',
});

describe('enveloped JSON round trip', () => {
  const serializer = new KafkaMessageEnvelopedJsonSerializeStrategy();
  const parser = new KafkaMessageEnvelopedJsonStrategy();

  const roundTrip = async (value: unknown) =>
    (await parser.parse(record(Buffer.from(serializer.serialize(value))))).value;

  it('returns a plain string unchanged', async () => {
    expect(await roundTrip('hello')).toBe('hello');
  });

  it('returns a numeric string unchanged', async () => {
    expect(await roundTrip('42')).toBe('42');
  });

  it('returns a JSON-looking string unchanged', async () => {
    expect(await roundTrip('{"a":1}')).toBe('{"a":1}');
  });

  it('returns an object unchanged', async () => {
    expect(await roundTrip({ orderId: 'o-1' })).toEqual({ orderId: 'o-1' });
  });

  it('returns an array unchanged', async () => {
    expect(await roundTrip([1, 2])).toEqual([1, 2]);
  });

  it('returns null unchanged', async () => {
    expect(await roundTrip(null)).toBeNull();
  });
});
