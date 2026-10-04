# Producing

Inject `ProducerProxy` to publish messages. It is connected eagerly during module initialisation; a
broker that is unreachable at startup fails module construction.

Idempotence, compression and acks are producer-wide; see
[`ProducerConfig`](configuration.md#producerconfig).

```ts
send(
  topic: string,
  message: MessageType<TValue>,
  options?: {
    namespaced?: boolean;
    messageFormat?: MessageFormat;
    schemaId?: number;
    subject?: string;
  },
): Promise<unknown>;
```

```ts
await this.producer.send(
  'orders.created',
  {
    key: 'ord_1',
    value: { orderId: 'ord_1', total: 4200 },
    headers: { 'x-correlation-id': correlationId },
  },
);
```

## Key

The record key is `message.key`. A string key is sent as its raw UTF-8 bytes, `null` sends a record
without a key, and an object key is sent as `JSON.stringify(key)`. Because string keys go out
unchanged, the client's default partitioner (`murmur2_random`) puts a record on the same partition
as the Java client's default partitioner does for the same string.

Consumers decode keys as described in [Message formats](message-formats.md#json), so a key
round-trips through JSON: a `Date` inside an object key arrives as its ISO string, a string key
whose text is a JSON object arrives as an object, and a `bigint` rejects the send.

## Value

The value follows the resolved format, which is `options.messageFormat`, then the module's
`messageFormat`, then `MessageFormat.JSON`:

- With `JSON` the value is `JSON.stringify(message.value)`, and a `null` value is sent as a record
  without a value (a tombstone).
- With `ENVELOPED_JSON` it is `{"payload":…}`, and a `null` value is written as `{"payload":null}`,
  not as a tombstone.
- With `AVRO` it is encoded through the schema registry, chosen by `options.schemaId`,
  `options.subject`, or the topic name; see [Producing Avro](message-formats.md#producing-avro).

With the JSON formats, a value JSON cannot encode, such as `undefined` or a function, rejects.

## Headers

The record's `headers` are `message.headers`. A header value is a string, or an array of strings to
send the header once per value.

## Topic

Topics are namespace-prefixed as described in [Topics and namespacing](topics-and-namespacing.md)
unless `options.namespaced` is `false`.

The producer does not create topics by default. A send to a missing topic rejects with a
`KafkaJSProtocolError` whose `code` is `ERR_UNKNOWN_TOPIC_OR_PART` (`Broker: Unknown topic or
partition`), and only after about 30 seconds, while librdkafka waits for the topic to appear in
metadata (`topic.metadata.propagation.max.ms`).

```ts
KafkaModule.register({
  clientOptions: { kafkaJS: { brokers: ['localhost:9092'] } },
  producer: { allowAutoTopicCreation: true },
});
```

With `producer: { allowAutoTopicCreation: true }`, the producer asks the broker to create a missing
topic on its first send, which works only when the broker has `auto.create.topics.enable=true`.
