import { KafkaMessage as KafkaJSMessage } from 'kafkajs';
import type { SchemaRegistry } from '@kafkajs/confluent-schema-registry';
import { KafkaMessageAvroStrategy } from './kafka-message-avro.strategy.js';

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

describe('KafkaMessageAvroStrategy', () => {
  const registry = {
    decode: jest.fn(),
  } as unknown as SchemaRegistry;

  const strategy = new KafkaMessageAvroStrategy<Payload>(registry);

  beforeEach(() => {
    (registry.decode as jest.Mock).mockReset();
    (registry.decode as jest.Mock).mockResolvedValue({
      payload: { orderId: 'o-1' },
    });
  });

  it('decodes the value through the schema registry', async () => {
    const parsed = await strategy.parse(record(Buffer.from([0, 1, 2])));

    expect(registry.decode).toHaveBeenCalledTimes(1);
    expect(parsed.value?.payload).toEqual({ orderId: 'o-1' });
  });

  it('decodes a plain string key that is not valid JSON', async () => {
    const parsed = await strategy.parse(
      record(Buffer.from([0, 1, 2]), Buffer.from('order-1')),
    );

    expect(parsed.key).toBe('order-1');
  });

  it('exposes a null value when the record carries no value', async () => {
    const parsed = await strategy.parse(record(null));

    expect(parsed.value).toBeNull();
    expect(registry.decode).not.toHaveBeenCalled();
  });
});
