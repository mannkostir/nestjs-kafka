# nestjs-kafka-connector

[![CI](https://github.com/mannkostir/nestjs-kafka/actions/workflows/ci.yml/badge.svg)](https://github.com/mannkostir/nestjs-kafka/actions/workflows/ci.yml)

A NestJS dynamic module that wires a Kafka client, a producer, a consumer, and decorator-driven
message-handler discovery into a host application, built on top of
[kafkajs](https://kafka.js.org/). Handlers are ordinary provider methods marked with
`@Message(...)`; the module discovers them on application bootstrap and subscribes each one to its
own Kafka consumer.

Messages are parsed by a pluggable strategy (JSON or Avro via Confluent Schema Registry), and
per-handler failures are routed through a pluggable error policy (`fail`, `ignore`, or `dlq`).

**Status: pre-1.0 (`0.2.1`).** The public API may still change between versions.
Integration-tested against `confluentinc/cp-kafka:7.6.1` in KRaft mode.

## Installation

```sh
npm install nestjs-kafka-connector kafkajs
```

The library has no runtime dependencies of its own. Everything it needs is a peer dependency that
the host application provides: `@nestjs/common`, `@nestjs/core`, `kafkajs`, and
`reflect-metadata`.

| Peer | Supported range |
| --- | --- |
| `@nestjs/common`, `@nestjs/core` | `^11.0.0 \|\| ^12.0.0` |
| `kafkajs` | `>=2.0.0` |
| `reflect-metadata` | `^0.2.0` |
| `@kafkajs/confluent-schema-registry` (optional) | `>=3.0.0` |

CI runs the type check, unit tests, and build against both NestJS 11 and NestJS 12, the
integration tests against NestJS 12, checks that both entry points of the built package load on
Node.js 20.19 and 22.12, and checks that the ES module entry loads on Node.js 20.18 and 22.11.

Avro support additionally needs the optional peer `@kafkajs/confluent-schema-registry`:

```sh
npm install @kafkajs/confluent-schema-registry
```

### Module formats

The package ships one implementation, compiled as ES modules, behind an `exports` map. `import`
resolves to the ES module build; `require` resolves to a CommonJS entry that loads that same build.
Both hand out the same classes, so a host that reaches the package through both still has a single
`ConsumerProxy` and `ProducerProxy`. Only the package root is exported: deep imports such as
`nestjs-kafka-connector/dist/...` are not available.

### Node.js versions

`engines` declares Node.js `^20.19.0` or `>=22.12.0`. That is exact for a CommonJS host, whose
`require` of this package loads ES modules through Node's `require(esm)` support, unflagged from
those versions. An ES module host needs nothing extra from this package and also runs on earlier
Node.js 20 and 22 releases, verified on 20.18 and 22.11, where npm only warns about `engines`.

### TypeScript

The `import` and `require` conditions each have declarations in their own module format. With
`skipLibCheck: false`, NestJS 11 and 12, ES module and CommonJS hosts, and `"moduleResolution"` set
to `"node16"`, `"nodenext"`, or `"bundler"` all type-check cleanly, with one exception: a CommonJS
host on NestJS 12 under `"node16"`, or under `"nodenext"` with TypeScript 5.7 or older. There the
host's own imports of the ESM-only NestJS 12 packages fail with `TS1479`, and this package's
declarations report the same. Use `"nodenext"` with TypeScript 5.8 or newer, or `"bundler"`.

### Testing with Jest

Jest runs tests in its own module sandbox, which cannot `require` ES modules unless Jest 30 runs
on Node.js 24.9 or newer with `--experimental-vm-modules`. A CommonJS host that tests with the
Nest CLI's default Jest setup therefore needs one of two changes. Run Jest with the flag:

```sh
node --experimental-vm-modules node_modules/jest/bin/jest.js
```

or let ts-jest transpile this package to CommonJS:

```js
module.exports = {
  testEnvironment: 'node',
  transform: {
    '^.+\\.[tj]s$': [
      'ts-jest',
      {
        tsconfig: {
          allowJs: true,
          experimentalDecorators: true,
          emitDecoratorMetadata: true,
          esModuleInterop: true,
        },
      },
    ],
  },
  transformIgnorePatterns: ['node_modules/(?!nestjs-kafka-connector/)'],
};
```

A NestJS 12 host needs the flag either way, because NestJS 12 is itself published as ES modules
only.

## Quickstart

Register the module anywhere in your application:

```ts
import { Module } from '@nestjs/common';
import { KafkaModule } from 'nestjs-kafka-connector';
import { OrderEventsHandler } from './order-events.handler';

@Module({
  imports: [
    KafkaModule.register({
      clientOptions: {
        clientId: 'orders-service',
        brokers: ['localhost:9092'],
      },
    }),
  ],
  providers: [OrderEventsHandler],
})
export class OrdersModule {}
```

Handlers are discovered application-wide, not scoped to the module that declares them. Declare a
handler as a method on any provider anywhere in the app:

```ts
import { Injectable, Logger } from '@nestjs/common';
import { Message, MessageType } from 'nestjs-kafka-connector';

type OrderCreated = { orderId: string; total: number };

@Injectable()
export class OrderEventsHandler {
  private readonly logger = new Logger(OrderEventsHandler.name);

  @Message(['orders.created'], {
    groupId: 'orders-service',
    errorHandling: { type: 'dlq' },
  })
  async handleOrderCreated(
    message: MessageType<OrderCreated>,
    topic: string | RegExp,
  ): Promise<void> {
    const order = message.value?.payload;

    if (!order) {
      return;
    }

    this.logger.log(`Order ${order.orderId} received from ${String(topic)}`);
  }
}
```

The second argument is the topic the batch was read from. It is typed `string | RegExp` to match the
declared patterns and is always the concrete topic string at runtime.

Publish messages by injecting `ProducerProxy`:

```ts
import { Injectable } from '@nestjs/common';
import { ProducerProxy } from 'nestjs-kafka-connector';

@Injectable()
export class OrderPublisher {
  constructor(private readonly producer: ProducerProxy) {}

  async publishCreated(orderId: string, total: number): Promise<void> {
    await this.producer.send('orders.created', {
      key: null,
      value: { payload: { orderId, total } },
    });
  }
}
```

`ConsumerProxy` and `ProducerProxy` are the module's only exported providers.

## Configuration

### Module options

`KafkaModule.register(options)` accepts:

| Option | Type | Required | Description |
| --- | --- | --- | --- |
| `clientOptions` | `KafkaConfig` (kafkajs) | yes | Passed straight to `new Kafka(...)`: `brokers`, `clientId`, `ssl`, `sasl`, and the rest. |
| `namespace` | `string` | no | Prefixes produced and consumed topics and consumer group ids. See [Topics, namespace, and group ids](#topics-namespace-and-group-ids). |
| `connectorName` | `string` | no | Scopes handler discovery when `KafkaModule` is registered more than once in the same app. See [Registering more than once](#registering-more-than-once). |
| `schemaRegistry` | `{ url: string }` | no | Enables Avro. Constructs a `SchemaRegistry` against `url`. |
| `consumerDefaults` | `ConsumerConfig` | no | Consumer settings applied to every handler unless overridden per handler. |

`namespace` and `connectorName` must not be empty strings: `''` fails module construction with an
error saying so. Leave either option `undefined` to opt out of it; this matters most when the value
comes from an environment variable that may be set but empty.

There is no `moduleName` option. Handlers are discovered application-wide regardless of which
module declares `KafkaModule` or which module declares the handler provider.

### Registering more than once

Registering `KafkaModule` twice in one application — for example to talk to two Kafka clusters —
would otherwise subscribe every discovered handler on both consumers, producing duplicate
consumption. `connectorName` addresses this: a module registered with a `connectorName` subscribes
only handlers whose `@Message` options declare the same `connectorName`; a module registered
without one subscribes only handlers that declare none.

```ts
KafkaModule.register({
  connectorName: 'analytics-cluster',
  clientOptions: { brokers: ['analytics-broker:9092'] },
});
```

```ts
@Message(['clicks.recorded'], {
  groupId: 'analytics-consumer',
  errorHandling: { type: 'ignore' },
  connectorName: 'analytics-cluster',
})
```

If you only ever register `KafkaModule` once, omit `connectorName` on both the module and every
handler.

### Asynchronous registration

`registerAsync` supports `useFactory`, `useClass`, and `useExisting`, and accepts `imports` and
`inject`.

```ts
KafkaModule.registerAsync({
  imports: [ConfigModule],
  inject: [ConfigService],
  useFactory: (config: ConfigService) => ({
    namespace: config.get('KAFKA_NAMESPACE'),
    clientOptions: {
      clientId: config.get('KAFKA_CLIENT_ID'),
      brokers: config.get<string>('KAFKA_BROKERS').split(','),
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
      clientOptions: { brokers: ['localhost:9092'] },
    };
  }
}
```

Passing none of the three throws at module construction.

### `@Message` options

```ts
@Message(topicPatterns: (string | RegExp)[], options: MessageOptions)
```

| Option | Type | Required | Default |
| --- | --- | --- | --- |
| `groupId` | `string` | yes | — |
| `errorHandling` | `MessageErrorHandlingConfig` | yes | — |
| `messageFormat` | `MessageFormat` | no | `MessageFormat.JSON` |
| `consumer` | `ConsumerConfig` | no | falls back to `consumerDefaults` |
| `namespaced` | `boolean` | no | `true` |
| `connectorName` | `string` | no | `undefined` — matches an unnamed module registration |

**Each handler needs its own `groupId`.** Within one connector, two `@Message` handlers that
declare the same `groupId` fail application bootstrap before any consumer connects, with an error
naming the group id and both handlers as `ClassName.methodName`. Handlers registered on different
connectors (different `connectorName`s) are checked separately.

The same check catches a handler class provided more than once — listed in the `providers` of
more than one module, or under a second token with `useClass`: each creates its own instance, which
would consume the topic twice. That failure says so and asks you to provide the class exactly once.
Aliasing a handler with `useExisting` is not a second registration and subscribes once.

### `ConsumerConfig`

The same shape is used for module-wide `consumerDefaults` and per-handler `consumer` overrides.

| Field | Type | Default |
| --- | --- | --- |
| `fromBeginning` | `boolean` | `false` |
| `allowAutoTopicCreation` | `boolean` | `true` |
| `heartbeatInterval` | `number` (ms) | unset — kafkajs applies its own (currently `3000`) |
| `sessionTimeout` | `number` (ms) | unset — kafkajs applies its own (currently `30000`) |
| `rebalanceTimeout` | `number` (ms) | unset — kafkajs applies its own (currently `60000`) |
| `retry` | `Partial<RetryOptions>` (kafkajs) | see below |

`heartbeatInterval`, `sessionTimeout`, and `rebalanceTimeout` are left unset unless you set them,
so kafkajs's own defaults apply — for `heartbeatInterval` that is `3000`. If you set
`heartbeatInterval`, keep it below the effective `sessionTimeout`: kafkajs rejects a heartbeat
interval that is not strictly less than the session timeout.

`retry` defaults are `maxRetryTime: 30000`, `initialRetryTime: 300`, `factor: 0.2`, `multiplier: 2`,
`retries: 15`, `restartOnFailure: async () => true`.

### Precedence

Configuration is resolved field by field, per handler:

1. the handler's own `options.consumer`
2. the module's `consumerDefaults`
3. the built-in default from the table above

`retry` is merged shallowly in the same order, so a handler that sets only `retries` keeps the
default `initialRetryTime` and the rest.

```ts
KafkaModule.register({
  clientOptions: { brokers: ['localhost:9092'] },
  consumerDefaults: {
    heartbeatInterval: 10000,
    retry: { retries: 5 },
  },
});
```

```ts
@Message(['orders.created'], {
  groupId: 'orders-service',
  errorHandling: { type: 'fail' },
  consumer: {
    fromBeginning: true,
    retry: { retries: 20 },
  },
})
```

That handler runs with `fromBeginning: true`, `heartbeatInterval: 10000`, `retries: 20`,
`initialRetryTime: 300`, and `allowAutoTopicCreation: true`.

## Topics, namespace, and group ids

`namespace` prefixes both produced and consumed topics and the consumer group id. It is applied
symmetrically:

- **Produced topics are prefixed.** `producer.send('orders.created', ...)` with `namespace: 'dev'`
  writes to `dev.orders.created`.
- **Consumed topics are prefixed the same way.** `@Message(['orders.created'], ...)` under
  `namespace: 'dev'` subscribes to `dev.orders.created`, so a namespaced producer and a namespaced
  consumer using the same logical topic name see each other.
- **Group ids are joined with a dash only when a namespace is set.** With `namespace: 'dev'` and
  `groupId: 'orders-service'` the effective group id is `dev-orders-service`. With no namespace it
  is `orders-service`, with no stray leading separator.

Prefixing is unconditional: there is no detection of an already-prefixed topic. Passing
`'dev.orders.created'` under `namespace: 'dev'` produces to `dev.dev.orders.created`. Name the
logical topic, not the namespaced one, in every call site.

### Pattern (RegExp) topics

A `RegExp` topic pattern given to `@Message` is rewritten so the namespace becomes part of the
match, not merely a produced/consumed string prefix. The namespace is regex-escaped before
insertion, so a namespace containing `.` cannot widen the match, and the original source is wrapped
in a non-capturing group so capture-group numbering and top-level alternation are preserved:

| Input pattern | Namespace `dev` | Reason |
| --- | --- | --- |
| `/^orders\..*/` | `/^dev\.(?:orders\..*)/` | Anchored: the prefix is inserted after `^`. |
| `/orders\.\w+/` | `/^dev\..*(?:orders\.\w+)/` | Unanchored: anchor, prefix, then allow any intermediate segments. |
| `/^orders\|payments/` | `/^dev\.(?:orders\|payments)/` | Without the group this would parse as `(^dev\.orders)\|(payments)` and match another stand's bare `payments` topic. |

Existing flags on the pattern are preserved, including `i` — a case-insensitive pattern gets a
case-insensitive namespace prefix too.

### Opting out per call site

Consuming or producing a topic owned by another system — one that must not be namespaced — is
opted out per call site:

- `@Message(topics, { namespaced: false })` on the handler.
- `send(topic, message, { namespaced: false })` on the producer.

`namespaced` defaults to `true` in both places.

**Namespacing is a convention, not an isolation boundary.** It enforces nothing at the broker: a
handler that opts out of namespacing still sees another stand's traffic on the same broker, and
nothing prevents another application from writing into your namespace's prefix. Use it to let
several environments or stands share one Kafka cluster without topic collisions by convention, not
as a security or access control.

### DLQ topics and namespacing

An explicitly configured DLQ topic (`errorHandling: { type: 'dlq', topic: 'orders.failures' }`) is
namespaced the same way as any other topic, honouring the handler's own `namespaced` flag. The
default DLQ topic (no `topic` given, derived as `${originalTopic}.dlq`) inherits the namespace
naturally, because it is derived from the topic the broker actually reported the record on, which
is already namespaced when the source subscription was.

## Message formats

### JSON

`MessageFormat.JSON` is the default and needs no extra configuration.

The record value is read as UTF-8 and passed through `JSON.parse` into a `{ payload }` envelope,
which is the shape `ProducerProxy.send` writes. If the parsed envelope's `payload` is itself a
string, it is parsed a second time, which accommodates producers that stringify the payload
separately.

**A malformed value raises.** If `JSON.parse` fails on the record value, parsing throws a
descriptive error instead of silently producing `value: null`. The error is routed through the
handler's configured `errorHandling` policy like any other failure, so a handler declaring
`{ type: 'dlq' }` dead-letters the poison record instead of ever seeing it.

**Keys decode leniently.** The record key is read as UTF-8 and parsed as JSON when that succeeds;
when it does not, the raw string is used as the key instead of raising. Kafka keys are untyped
bytes, so both branches yield a usable key.

```ts
message.key;
message.value;
message.value?.payload;
```

### Avro

Supply a registry URL at module registration and install
`@kafkajs/confluent-schema-registry`, which is an **optional peer dependency** — only installed by
consumers who use Avro:

```ts
KafkaModule.register({
  clientOptions: { brokers: ['localhost:9092'] },
  schemaRegistry: { url: 'http://localhost:8081' },
});
```

```ts
@Message(['orders.created'], {
  groupId: 'orders-service',
  messageFormat: MessageFormat.AVRO,
  errorHandling: { type: 'dlq' },
})
async handleOrderCreated(message: MessageType<OrderCreated>): Promise<void> {}
```

The record value is decoded by the registry. The record key decodes the same leniently-JSON way as
in JSON mode.

Declaring an Avro handler without `schemaRegistry` options throws at bootstrap with a message
naming both the option and the package to install. Producing is JSON-only: `ProducerProxy.send`
always stringifies the value.

## Error handling

Every handler declares an `errorHandling` policy. It applies when the handler method rejects, and
also when parsing the record throws.

### `{ type: 'fail' }`

Rethrows. The offset is not resolved, so the batch is retried according to the consumer's `retry`
configuration and the message is redelivered. Once those retries are exhausted, the default
`restartOnFailure: async () => true` restarts the consumer, which reads the same message again. A
message that always fails — a poison message — therefore blocks its partition until the handler or
the message is fixed. Use `dlq` or `ignore` when one bad message must not stall its partition.

```ts
errorHandling: { type: 'fail' }
```

### `{ type: 'ignore' }`

Resolves the offset, heartbeats, and moves to the next message. The failure is not recorded
anywhere; the message is not redelivered.

```ts
errorHandling: { type: 'ignore' }
```

### `{ type: 'dlq', topic?: string }`

Produces the original record to a dead-letter topic, then resolves the offset and heartbeats, so
the message is not redelivered.

```ts
errorHandling: { type: 'dlq' }
errorHandling: { type: 'dlq', topic: 'orders.failures' }
```

Without `topic`, the destination is the source topic plus a `.dlq` suffix — `orders.created` becomes
`orders.created.dlq`.

The original headers are preserved, and these are added:

| Header | Value |
| --- | --- |
| `dlq.original.topic` | topic the record was consumed from |
| `dlq.error.message` | `error.message`, or `Unknown error` |
| `dlq.error.name` | `error.name`, or `Error` |
| `dlq.error.stack` | `error.stack`, present only when the error has one |
| `dlq.timestamp` | ISO 8601 timestamp of the failure |

DLQ delivery uses the module's producer. Strategy instances are cached per configuration on the
consumer, so a strategy is shared across every handler that declares the same policy.

**Known limitation: handlers cannot see headers.** `@Message` handlers receive `key` and `value`
only — the consumed record's headers are not exposed through `MessageType`. A handler subscribed to
a DLQ topic through this library therefore cannot read the `dlq.*` headers above. Inspect them with
a plain kafkajs consumer instead.

## Producing

`ProducerProxy` is connected eagerly during module initialisation; a broker that is unreachable at
startup fails module construction.

```ts
send(
  topic: string,
  message: MessageType<TPayload>,
  options?: { key?: string; namespaced?: boolean },
): Promise<unknown>;
```

The record's `value` is `JSON.stringify(message.value)` and its `headers` are `message.headers`.
The record key comes from `options.key`, not from `message.key`. Topics are namespace-prefixed as
described above unless `options.namespaced` is `false`, and the underlying producer is created with
`allowAutoTopicCreation: true` and kafkajs's `Partitioners.DefaultPartitioner`, which assigns keyed
records to partitions the same way the Java client does.

```ts
await this.producer.send(
  'orders.created',
  {
    key: null,
    value: { payload: { orderId: 'ord_1', total: 4200 } },
    headers: { 'x-correlation-id': correlationId },
  },
  { key: 'ord_1' },
);
```

## Delivery semantics

**Delivery is at-least-once. Handlers must be idempotent.** A handler can succeed and the process
can die before its offset is committed, in which case the message is delivered again on restart.

- **One kafkajs consumer per handler, in its own consumer group.** Each `@Message` method gets its
  own consumer, created, connected, and run at application bootstrap. Handlers of one connector
  cannot share a `groupId`: kafkajs assigns a group's partitions only for the topics its leader
  subscribed to, so a shared group across different topics silently starves one handler, and on the
  same topics it splits the messages between two different methods. Bootstrap fails instead; see
  [`@Message` options](#message-options).
- **Offsets are resolved manually.** Consumers run with `eachBatchAutoResolve: false`. Within a
  batch, each message is parsed, passed to the handler, and only then is its offset resolved,
  followed by a heartbeat. A failing message never has its offset resolved by the framework — that
  decision belongs to the error policy.
- **Batches stop early when the consumer is stopping or the assignment is stale.** Before each
  message the loop checks `isRunning()` and `isStale()` and breaks out, leaving the remaining
  offsets unresolved for redelivery.
- **A topic that does not exist yet is waited for, briefly.** When `allowAutoTopicCreation` is
  enabled (the default), subscribing to a topic the broker does not have yet retries up to 5 times
  with backoff, about 2.5 seconds in total, logging a warning naming the topic on each retry. Any
  other subscribe failure — a different error, auto-creation disabled, or the retries running out —
  is not retried. On a broker configured with `auto.create.topics.enable=false`, topics must exist
  before the application starts.
- **A failed subscription fails application bootstrap.** If any handler's `subscribe()` call
  ultimately throws — including a topic that never gets created — the consumer that was being
  opened is disconnected and the error propagates out of `onApplicationBootstrap`, which fails Nest
  application bootstrap. No consumer connection is left open for the handler that failed to
  subscribe, but consumers of other handlers that had already connected, and the producer, stay
  open until `app.close()` is called. A host that catches the bootstrap error and keeps running
  must close the application itself.
- **Shutdown closes consumers before the producer.** `onModuleDestroy` disconnects every consumer
  and logs any that fail; `beforeApplicationShutdown`, which Nest runs after every destroy hook,
  then disconnects the producer. DLQ publishes and producer calls made from handlers therefore
  still have a connected producer while the consumers stop. Call `app.enableShutdownHooks()` in the
  host application so these run on `SIGTERM` and `SIGINT`.

## Development

Running the tests needs Node.js 24.9 or newer. NestJS 12 is ESM-only, and Jest can load it only
through `require(esm)` inside its module sandbox, which is available from Node.js 24.9 behind
`--experimental-vm-modules`. The npm scripts pass that flag for you.

```sh
npm test
npm run test:integration
npx tsc --noEmit
npm run build
```

`npm run test:integration` starts a Kafka broker with Testcontainers and needs a running Docker
daemon.
