# Producing

Inject `ProducerProxy` to publish messages. It is connected eagerly during module initialisation; a
broker that is unreachable at startup fails module construction.

```ts
send(
  topic: string,
  message: MessageType<TValue>,
  options?: { key?: string; namespaced?: boolean; messageFormat?: MessageFormat },
): Promise<unknown>;
```

```ts
await this.producer.send(
  'orders.created',
  {
    key: null,
    value: { orderId: 'ord_1', total: 4200 },
    headers: { 'x-correlation-id': correlationId },
  },
  { key: 'ord_1' },
);
```

## Key

The record key comes from `options.key`, not from `message.key`. The client's default partitioner
(`murmur2_random`) assigns keyed records to partitions the same way the Java client does.

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
