# Producing

Inject `ProducerProxy` to publish messages. It is connected eagerly during module initialisation; a
broker that is unreachable at startup fails module construction.

Idempotence, compression and acks are producer-wide; see
[`ProducerOptions`](configuration.md#produceroptions).

```ts
send<TValue>(
  topic: string,
  message: KafkaMessage<TValue>,
  options?: ProducerSendOptions,
): Promise<ProducedRecord[]>;
```

`TValue` is chosen per call, so one injected `ProducerProxy` sends any value type. A test double
extends `ProducerProxy` and implements this one method.

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

## Send options

The exported `ProducerSendOptions` type has only optional fields; omitting it uses these defaults:

| Field | Type | Default and semantics |
| --- | --- | --- |
| `namespaced` | `boolean` | `true`; set `false` to send to the exact supplied topic, without the module namespace. |
| `messageFormat` | `MessageFormat` | Module format, then `MessageFormat.JSON`; overrides encoding for this send. |
| `schemaId` | `number` | Unset; for Avro, selects a positive integer registry id instead of looking up the latest schema. |
| `subject` | `string` | Unset; for Avro, overrides the latest-schema subject, whose default is `<effective topic>-value`. Must be nonblank. |

For Avro, supply at most one of `schemaId` and `subject`; passing both rejects. JSON formats ignore
both fields. See [Producing Avro](message-formats.md#producing-avro) for caching and failures.
Serialization or broker delivery failures reject the `send` promise and propagate to the caller;
consumer error policies do not automatically retry an application send.

## Selecting a connector

For multiple connectors, give each registration a distinct `connectorName` and inject its
producer with `InjectProducer(connectorName: string)`, a Nest injection decorator. It selects the
producer registered under that name. The named injection helpers are exported from
`nestjs-kafka-connector`.

```ts
import { Injectable, Module } from '@nestjs/common';
import { InjectProducer, KafkaModule, ProducerProxy } from 'nestjs-kafka-connector';

@Injectable()
class Publisher {
  constructor(
    @InjectProducer('analytics') private readonly analytics: ProducerProxy,
    @InjectProducer('billing') private readonly billing: ProducerProxy,
  ) {}

  async recordClick(): Promise<void> {
    await this.analytics.send('clicks.recorded', { key: null, value: { page: '/' } });
  }
}

@Module({
  imports: [
    KafkaModule.register({
      connectorName: 'analytics',
      clientOptions: { kafkaJS: { brokers: ['analytics:9092'] } },
    }),
    KafkaModule.register({
      connectorName: 'billing',
      clientOptions: { kafkaJS: { brokers: ['billing:9092'] } },
    }),
  ],
  providers: [Publisher],
})
class AppModule {}
```

`getProducerToken(connectorName: string): string` returns the named injection token. For example,
`getProducerToken('analytics')` returns the same token used by
`@InjectProducer('analytics')`. Use it with Nest's `@Inject`, factory provider `inject` arrays,
`app.get`, or test provider overrides. The named token aliases the existing producer instance;
it does not open an additional connection. The module still exports `ProducerProxy` for existing
registrations and single-connector applications. With multiple registrations, plain
`ProducerProxy` injection does not select a particular connector; use a named token for that.

For async registration, set `connectorName` at the top level so the module can declare the token
before the options factory executes:

```ts
KafkaModule.registerAsync({
  connectorName: 'analytics',
  useFactory: async () => ({
    clientOptions: { kafkaJS: { brokers: ['analytics:9092'] } },
  }),
});
```

This works with `useFactory`, `useClass`, and `useExisting`. The top-level name is applied to the
resolved options when they omit `connectorName`, including for `@Message` handler selection.
If the resolved options explicitly provide another name, registration fails before opening a
producer connection. Returning the same name is also valid. Existing factories that return a
name without setting the top-level name remain valid and support plain `ProducerProxy`
injection, but do not export a named producer token. Names must be non-empty strings.

## Result

`send` resolves when the client reports the record delivered, to an array holding its
`ProducedRecord`:

```ts
type ProducedRecord = {
  topic: string;
  partition: number;
  offset: string;
};
```

`topic` is the topic the broker wrote to, after namespacing. `offset` is the record's offset as a
decimal string; with `acks: 0` the broker reports none and it is `'-1001'`.

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
