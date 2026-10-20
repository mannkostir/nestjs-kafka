# Configuration

## Module options

`KafkaModule.register(options)` accepts:

| Option | Type | Required | Description |
| --- | --- | --- | --- |
| `clientOptions` | `KafkaJS.CommonConstructorConfig` (`@confluentinc/kafka-javascript`) | yes | Passed to `new KafkaJS.Kafka(...)`, with a Nest-backed `kafkaJS.logger` added when none is set (see below). KafkaJS-compatible options — `brokers`, `clientId`, `ssl`, `sasl`, and the rest — go under `kafkaJS`: `{ kafkaJS: { brokers, clientId, ssl, sasl } }`. librdkafka properties (e.g. `'socket.keepalive.enable'`) sit alongside `kafkaJS`, outside that block. |
| `namespace` | `string` | no | Prefixes produced and consumed topics and consumer group ids. See [Topics and namespacing](topics-and-namespacing.md). |
| `connectorName` | `string` | no | Scopes handler discovery when `KafkaModule` is registered more than once in the same app. See [Registering more than once](#registering-more-than-once). |
| `schemaRegistry` | `{ url: string }` | no | Enables Avro. Constructs a `SchemaRegistry` against `url`. |
| `consumerDefaults` | `ConsumerOptions` | no | Consumer settings applied to every handler unless overridden per handler. |
| `producer` | `ProducerOptions` | no | Settings for the module's producer. See [`ProducerOptions`](#produceroptions). |
| `messageFormat` | `MessageFormat`: `'json' \| 'enveloped-json' \| 'avro'` | no | Default format for every consumer and for the producer. Defaults to `MessageFormat.JSON`. A handler's `@Message({ messageFormat })` and a send's `{ messageFormat }` override it. See [Message formats](message-formats.md). |
| `shutdownTimeout` | `number` (ms) | no | How long shutdown waits for consumers to disconnect before it continues without them. Defaults to `10000`. See [Shutdown](delivery-semantics.md#shutdown). |

The options are validated once, at module construction, for `register` and for every
`registerAsync` form (`useFactory`, `useClass`, `useExisting`). `clientOptions` must be an object;
`namespace` and `connectorName` must be non-empty strings when set; `schemaRegistry` must be an
object with a non-empty `url` when set; `consumerDefaults` and `producer` must be objects when set;
`messageFormat` must be a `MessageFormat` value when set; `shutdownTimeout` must be a non-negative
finite number when set. A factory that returns or resolves to anything other than an options object
fails too. Every problem is reported in one error, each line saying how to fix it. Leave `namespace`
or `connectorName` `undefined` to opt out of it rather than setting `''`; this matters most when the
value comes from an environment variable that may be set but empty.

Every Kafka client the module creates (handler consumers, the producer, and the admin clients that
provision topics and pin start offsets) logs through Nest's `Logger` with the context `KafkaClient`,
so the client's lines follow the host's Nest log format and log levels. Pass
`clientOptions.kafkaJS.logger` to route all of them elsewhere.

The logger travels in the client's `kafkaJS` block, which puts every client in KafkaJS
compatibility mode. When `clientOptions` has no `kafkaJS` block, the admin clients therefore run with
the compatibility defaults instead of librdkafka's: `socket.timeout.ms` 30000 (librdkafka 60000),
`socket.connection.setup.timeout.ms` 11000 (30000), `retry.backoff.ms` 300 (100) and
`retry.backoff.max.ms` 30000 (1000). The producer and the consumers already run in this mode. Set
any of these as a librdkafka property in `clientOptions` to override it for every client.

`ProducerProxy` is the module's only exported provider. Consumers are internal: handlers subscribe
only through `@Message` and `@MessageBatch`.

There is no `moduleName` option. Handlers are discovered application-wide regardless of which
module declares `KafkaModule` or which module declares the handler provider.

## Registering more than once

Registering `KafkaModule` twice in one application — for example to talk to two Kafka clusters —
would otherwise subscribe every discovered handler on both consumers, producing duplicate
consumption. `connectorName` addresses this: a module registered with a `connectorName` subscribes
only handlers whose `@Message` options declare the same `connectorName`; a module registered
without one subscribes only handlers that declare none.

```ts
KafkaModule.register({
  connectorName: 'analytics-cluster',
  clientOptions: { kafkaJS: { brokers: ['analytics-broker:9092'] } },
});
```

```ts
@Message(['clicks.recorded'], {
  groupId: 'analytics-consumer',
  errorHandling: { type: 'ignore' },
  connectorName: 'analytics-cluster',
})
```

A handler whose `connectorName` no registered module declares, or a handler without one when every
module is registered with a `connectorName`, would never be subscribed. Bootstrap fails instead,
before any handler subscribes, with one error naming each unknown `connectorName` with its handlers
and listing the registered ones:

```
Message handlers name connectorNames that no KafkaModule registers:
- "analytcs": ClicksHandler.onClick
Registered connectorNames: the unnamed connector, "analytics-cluster".
Set each handler's connectorName to a registered one, or register a KafkaModule with that connectorName.
```

If you only ever register `KafkaModule` once, omit `connectorName` on both the module and every
handler.

## Asynchronous registration

`registerAsync` supports `useFactory`, `useClass`, and `useExisting`, and accepts `imports` and
`inject`.

```ts
KafkaModule.registerAsync({
  imports: [ConfigModule],
  inject: [ConfigService],
  useFactory: (config: ConfigService) => ({
    namespace: config.get('KAFKA_NAMESPACE'),
    clientOptions: {
      kafkaJS: {
        clientId: config.get('KAFKA_CLIENT_ID'),
        brokers: config.get<string>('KAFKA_BROKERS').split(','),
      },
    },
  }),
});
```

`useClass` and `useExisting` take a class implementing `KafkaModuleOptionsFactory`:

```ts
import { Injectable } from '@nestjs/common';
import {
  KafkaModuleOptions,
  KafkaModuleOptionsFactory,
} from 'nestjs-kafka-connector';

@Injectable()
export class KafkaConfigFactory implements KafkaModuleOptionsFactory {
  createKafkaOptions(): KafkaModuleOptions {
    return {
      clientOptions: { kafkaJS: { brokers: ['localhost:9092'] } },
    };
  }
}
```

Passing none of the three throws at module construction.

## `@Message` options

```ts
@Message(topicPatterns: (string | RegExp)[], options: MessageOptions)
```

| Option | Type | Required | Default |
| --- | --- | --- | --- |
| `groupId` | `string` | yes | — |
| `errorHandling` | `MessageErrorHandlingOptions` | yes | — |
| `messageFormat` | `MessageFormat` | no | the module's `messageFormat`, then `MessageFormat.JSON` |
| `consumer` | `ConsumerOptions` | no | falls back to `consumerDefaults` |
| `namespaced` | `boolean` | no | `true` |
| `connectorName` | `string` | no | `undefined` — matches an unnamed module registration |
| `sharedGroup` | `boolean` | no | `false` — the handler gets its own consumer group |

`errorHandling` is described in [Error handling](error-handling.md). Each handler needs its own
`groupId` unless every handler on that `groupId` sets `sharedGroup: true`;
see [Handlers](handlers.md#sharing-a-consumer-group).

## `ConsumerOptions`

The same shape is used for module-wide `consumerDefaults` and per-handler `consumer` overrides.

| Field | Type | Default |
| --- | --- | --- |
| `fromBeginning` | `boolean` | `false` |
| `createMissingTopics` | `boolean` | `false` |
| `heartbeatInterval` | `number` (ms) | unset — the client applies its own (currently `3000`) |
| `sessionTimeout` | `number` (ms) | unset — the client applies its own (currently `30000`) |
| `rebalanceTimeout` | `number` (ms) | unset — the client applies its own (currently `300000`) |
| `partitionsConsumedConcurrently` | `number` | `1` |
| `retry` | `ConsumerRetryOptions` | see below |

`heartbeatInterval`, `sessionTimeout`, and `rebalanceTimeout` are left unset unless you set them,
so the client's own defaults apply. Keep `heartbeatInterval` well below the effective
`sessionTimeout`, as Kafka requires. `rebalanceTimeout` maps to librdkafka's
`max.poll.interval.ms`; bootstrap's wait for group assignment (see
[Delivery semantics](delivery-semantics.md#bootstrap-waits-for-group-assignment)) is bounded by
`rebalanceTimeout + sessionTimeout`.

`partitionsConsumedConcurrently` is how many of a handler's assigned partitions its consumer
processes at the same time. It must be a positive integer; anything else fails bootstrap with an
error saying so. The effective concurrency is capped by the number of partitions assigned to that
consumer. See [Ordering and concurrency](delivery-semantics.md#ordering-and-concurrency).

`retry` is `ConsumerRetryOptions`, the client's backoff for retrying failed broker requests:
`maxRetryTime` (ms, default `30000`) and `initialRetryTime` (ms, default `300`). These are the only
retry settings the client applies to a consumer, and the only fields the library passes on to it.
Retrying a failed handler is a separate concern, configured through
[`errorHandling`](error-handling.md).

`createMissingTopics` controls [topic provisioning](topics-and-namespacing.md#topic-provisioning):
with `false`, bootstrap fails when a handler's topics, or its DLQ topic, do not exist; with `true`,
the library creates them through the admin API, whatever the broker's `auto.create.topics.enable`
says. It is unrelated to the producer's [`allowAutoTopicCreation`](#produceroptions).

## Precedence

Configuration is resolved field by field, per handler:

1. the handler's own `options.consumer`
2. the module's `consumerDefaults`
3. the built-in default from the table above

`retry` is merged shallowly in the same order, so a handler that sets only `maxRetryTime` keeps the
`initialRetryTime` from `consumerDefaults` or the default.

```ts
KafkaModule.register({
  clientOptions: { kafkaJS: { brokers: ['localhost:9092'] } },
  consumerDefaults: {
    heartbeatInterval: 10000,
    retry: { maxRetryTime: 5000 },
  },
});
```

```ts
@Message(['orders.created'], {
  groupId: 'orders-service',
  errorHandling: { type: 'fail' },
  consumer: {
    fromBeginning: true,
    retry: { maxRetryTime: 20000 },
  },
})
```

That handler runs with `fromBeginning: true`, `heartbeatInterval: 10000`,
`maxRetryTime: 20000`, `initialRetryTime: 300`, and `createMissingTopics: false`.

## `ProducerOptions`

The module's `producer` option.

| Field | Type | Default |
| --- | --- | --- |
| `allowAutoTopicCreation` | `boolean` | `false` |
| `idempotent` | `boolean` | unset — the client applies its own (currently `false`) |
| `compression` | `ProducerCompression`: `'none' \| 'gzip' \| 'snappy' \| 'lz4' \| 'zstd'` | unset — the client applies its own (currently `none`) |
| `acks` | `-1 \| 0 \| 1` | unset — the client applies its own (currently `-1`, all in-sync replicas) |

`allowAutoTopicCreation` maps to librdkafka's `allow.auto.create.topics` on the producer. See
[Producing](producing.md#topic) for what a send to a missing topic does.

`idempotent`, `compression` and `acks` map to librdkafka's `enable.idempotence`,
`compression.codec` and `acks`. An unset field is not passed, so the client default applies. An
unknown `compression` fails module construction. They apply to the whole producer; there is no
per-send `acks` or `compression`. `idempotent: true` requires `acks` to be unset or `-1`; any other
`acks` fails module construction.
