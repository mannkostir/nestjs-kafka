# Producing

Inject `ProducerProxy` to publish messages. It is connected eagerly during module initialisation; a
broker that is unreachable at startup fails module construction.

```ts
send(
  topic: string,
  message: MessageType<TValue>,
  options?: { namespaced?: boolean; messageFormat?: MessageFormat },
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
as a Java producer or kcat keying by the same string.

## Value

The value follows the resolved format, which is `options.messageFormat`, then the module's
`messageFormat`, then `MessageFormat.JSON`:

- With `JSON` the value is `JSON.stringify(message.value)`, and a `null` value is sent as a record
  without a value (a tombstone).
- With `ENVELOPED_JSON` it is `{"payload":…}`, and a `null` value is written as `{"payload":null}`,
  not as a tombstone.
- `AVRO` is not supported for producing and rejects.

A value JSON cannot encode, such as `undefined` or a function, rejects.

## Headers

The record's `headers` are `message.headers`. A header value is a string, or an array of strings to
send the header once per value.

## Topic

Topics are namespace-prefixed as described in [Topics and namespacing](topics-and-namespacing.md)
unless `options.namespaced` is `false`. The underlying producer is created with
`allowAutoTopicCreation: true`, so a missing topic is created on first send when the broker allows
auto-creation.
