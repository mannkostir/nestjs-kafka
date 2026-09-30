# nestjs-kafka-connector

[![CI](https://github.com/mannkostir/nestjs-kafka/actions/workflows/ci.yml/badge.svg)](https://github.com/mannkostir/nestjs-kafka/actions/workflows/ci.yml)

A NestJS dynamic module that wires a Kafka client, a producer, a consumer, and decorator-driven
message-handler discovery into a host application, built on top of
[`@confluentinc/kafka-javascript`](https://github.com/confluentinc/confluent-kafka-javascript)'s
KafkaJS-compatible API (backed by librdkafka). Handlers are ordinary provider methods marked with
`@Message(...)`; the module discovers them on application bootstrap and subscribes each one to its
own Kafka consumer.

Messages are parsed by a pluggable strategy (JSON or Avro via Confluent Schema Registry), and
per-handler failures are routed through a pluggable error policy (`fail`, `ignore`, or `dlq`).

**Status: pre-1.0 (`0.2.1`).** The public API may still change between versions.
Integration-tested against `confluentinc/cp-kafka:7.6.1` in KRaft mode.

## Compared with `@nestjs/microservices`

`@nestjs/microservices` ships its own Kafka transport (`Transport.KAFKA`). Both sit on top of a
Kafka client and move messages into NestJS providers, but they solve different shapes of problem.

| | This library | `@nestjs/microservices` (Kafka transport) |
| --- | --- | --- |
| Bootstrap | A plain dynamic module (`KafkaModule.register`) in any Nest application | A dedicated microservice (`NestFactory.createMicroservice()`) or a hybrid app (`app.connectMicroservice()`) |
| Consumer groups | One consumer group per `@Message` handler | One `groupId`, set once for the whole server in `options.consumer` (not per handler); `postfixId` customises the `-client` / `-server` suffix Nest appends to `clientId` and `groupId` |
| Dead-letter routing | Built-in `errorHandling: { type: 'dlq' }` policy | No built-in mechanism; the docs show a hand-rolled `KafkaMaxRetryExceptionFilter` that republishes with a retry-count header and commits the offset once retries are exhausted |
| Avro / schema registry | Built-in `MessageFormat.AVRO`, backed by `@kafkajs/confluent-schema-registry` | Not documented |
| Offset handling on handler failure | Per the three `errorHandling` policies (`fail`, `ignore`, `dlq`) | Auto-commit by default; disable with `run: { autoCommit: false }` and commit manually via `KafkaContext`. A thrown exception makes `kafkajs` retry the message instead of committing its offset — always for `@EventPattern` handlers, only via the dedicated `KafkaRetriableException` for `@MessagePattern` handlers |
| Topic namespacing | Built-in `namespace` option, applied symmetrically to topics and group ids | Not documented |
| Underlying client | `@confluentinc/kafka-javascript` (librdkafka) | `kafkajs` |

Use Nest's transport instead if you need request-reply over Kafka (`@MessagePattern` with a reply
topic), want one codebase to switch between transports, or prefer first-party support.

## Installation

```sh
npm install nestjs-kafka-connector @confluentinc/kafka-javascript
```

`@confluentinc/kafka-javascript` ships prebuilt native binaries for its supported platforms, so
this install does not need a local build toolchain on those platforms (see
[Node.js versions](#nodejs-versions)).

The library has no runtime dependencies of its own. Everything it needs is a peer dependency that
the host application provides: `@nestjs/common`, `@nestjs/core`, `@confluentinc/kafka-javascript`,
and `reflect-metadata`.

| Peer | Supported range |
| --- | --- |
| `@nestjs/common`, `@nestjs/core` | `^11.0.0 \|\| ^12.0.0` |
| `@confluentinc/kafka-javascript` | `^1.10.0` |
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

`@confluentinc/kafka-javascript` (`1.10.1`) ships prebuilt native binaries only for Node.js 18, 20,
21, 22, 23, and 24, on darwin (arm64/x64), linux glibc and musl (arm64/x64), and win32 (x64). On any
other Node.js version — Node.js 25 or 26, for example — `npm install` falls back to compiling
librdkafka from source, which needs a working C++ toolchain on the machine running the install.

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

## Migrating from 0.2.x

0.3.0 replaces `kafkajs` with `@confluentinc/kafka-javascript`. This is a breaking change:

1. Swap the peer: `npm uninstall kafkajs && npm install @confluentinc/kafka-javascript`.
2. Wrap your client options in `kafkaJS`:

   ```ts
   KafkaModule.register({
     clientOptions: { kafkaJS: { clientId: 'orders', brokers: ['kafka:9092'] } },
   });
   ```
3. Remove `factor`, `multiplier`, and `restartOnFailure` from any `retry` option; the client fixes
   them and throws if you set them.
4. Rewrite any `RegExp` topic pattern that used JS-only syntax. Topic patterns are now matched as
   POSIX extended regular expressions: flags (`/x/i`), `(?` groups (non-capturing, lookaround,
   inline flags), lazy quantifiers, and letter or digit escapes (`\d`, `\w`, `\s`, `\b`) are
   rejected at bootstrap with a message saying how to rewrite the pattern. See
   [Pattern (RegExp) topics](#pattern-regexp-topics).
5. Grant the application's Kafka principal Create permission on every topic its handlers consume.
   The library now creates missing plain-string topics itself before subscribing, even when the
   broker has `auto.create.topics.enable=false`; with `allowAutoTopicCreation: false`, bootstrap
   instead fails naming the missing topics. See
   [Topic provisioning](#topic-provisioning).
6. Expect application bootstrap to wait for each handler's consumer to join its group and receive
   its first partition assignment, roughly one heartbeat interval when other replicas are already
   in the group. A handler subscribed only to `RegExp` patterns does not wait; see
   [Delivery semantics](#delivery-semantics).
7. `fail` still backs off between redeliveries, but no longer through the consumer `retry` options
   or a consumer restart: `retry` and `restartOnFailure` no longer govern it. It now pauses only the
   failing partition, with an exponential delay of `300` ms doubling up to `30000` ms by default;
   tune it with `errorHandling: { type: 'fail', backoff: { ... } }`, or set `backoff: false` for
   immediate redelivery. See [`{ type: 'fail' }`](#-type-fail-).
8. `rebalanceTimeout` now maps to `max.poll.interval.ms`: a batch that takes longer than it gets the
   consumer evicted from its group. Raise it rather than lower it if handlers are slow.
9. Handler consumers now log through Nest's `Logger` (context `KafkaClient`) instead of the
   client's default logger when `clientOptions.kafkaJS.logger` is unset. A logger passed there
   still receives every consumer log line.
10. A handler whose principal may not read one of its subscribed topics, or its group, now fails
    bootstrap immediately with an error naming the group and the broker's reason, instead of
    waiting for its partition assignment.

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
        kafkaJS: {
          clientId: 'orders-service',
          brokers: ['localhost:9092'],
        },
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

A handler's provider must be a singleton, and so must every provider it injects. A Kafka message has
no request to scope an instance to, so a `@Message` handler on a request-scoped or transient
provider, or on a provider that depends on a request-scoped one, fails application bootstrap with an
error naming the handler and its scope.

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
| `clientOptions` | `KafkaJS.CommonConstructorConfig` (`@confluentinc/kafka-javascript`) | yes | Passed straight to `new KafkaJS.Kafka(...)`. KafkaJS-compatible options — `brokers`, `clientId`, `ssl`, `sasl`, and the rest — go under `kafkaJS`: `{ kafkaJS: { brokers, clientId, ssl, sasl } }`. librdkafka properties (e.g. `'socket.keepalive.enable'`) sit alongside `kafkaJS`, outside that block. |
| `namespace` | `string` | no | Prefixes produced and consumed topics and consumer group ids. See [Topics, namespace, and group ids](#topics-namespace-and-group-ids). |
| `connectorName` | `string` | no | Scopes handler discovery when `KafkaModule` is registered more than once in the same app. See [Registering more than once](#registering-more-than-once). |
| `schemaRegistry` | `{ url: string }` | no | Enables Avro. Constructs a `SchemaRegistry` against `url`. |
| `consumerDefaults` | `ConsumerConfig` | no | Consumer settings applied to every handler unless overridden per handler. |

`namespace` and `connectorName` must not be empty strings: `''` fails module construction with an
error saying so. Leave either option `undefined` to opt out of it; this matters most when the value
comes from an environment variable that may be set but empty.

Handler consumers, and the admin client each one uses to pin its start offsets, log through Nest's
`Logger` with the context `KafkaClient`. The producer and the admin client that provisions topics
log through the client's own default logger. Pass `clientOptions.kafkaJS.logger` to route all of
them elsewhere.

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
| `heartbeatInterval` | `number` (ms) | unset — the client applies its own (currently `3000`) |
| `sessionTimeout` | `number` (ms) | unset — the client applies its own (currently `30000`) |
| `rebalanceTimeout` | `number` (ms) | unset — the client applies its own (currently `300000`) |
| `retry` | `KafkaJS.RetryOptions` (`@confluentinc/kafka-javascript`) | see below |

`heartbeatInterval`, `sessionTimeout`, and `rebalanceTimeout` are left unset unless you set them,
so the client's own defaults apply — for `heartbeatInterval` that is `3000`. Keep
`heartbeatInterval` well below the effective `sessionTimeout`, as Kafka requires. `rebalanceTimeout`
maps to librdkafka's `max.poll.interval.ms`; bootstrap's wait for group assignment (see
[Delivery semantics](#delivery-semantics)) is bounded by `rebalanceTimeout + sessionTimeout`.

`retry` is `KafkaJS.RetryOptions`: `maxRetryTime`, `initialRetryTime`, `retries`. Defaults are
`maxRetryTime: 30000` and `initialRetryTime: 300`. `factor`, `multiplier`, and `restartOnFailure`
are no longer configurable — the client fixes them (`0.2`, `2`, and always-restart respectively)
and throws if you set them. `retries` is read only for produce requests; setting it in a handler's
or module's consumer `retry` has no effect on that consumer.

### Precedence

Configuration is resolved field by field, per handler:

1. the handler's own `options.consumer`
2. the module's `consumerDefaults`
3. the built-in default from the table above

`retry` is merged shallowly in the same order, so a handler that sets only `retries` keeps the
default `initialRetryTime` and the rest.

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
`maxRetryTime: 20000`, `initialRetryTime: 300`, and `allowAutoTopicCreation: true`.

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

A `RegExp` topic pattern given to `@Message` is matched by librdkafka, which compiles it as a
**POSIX extended regular expression** (`regcomp` on Linux and macOS) — not as a JavaScript `RegExp`.
Only a subset of JavaScript regex syntax survives that translation:

- **Supported:** plain `(...)` groups, `|`, bracket expressions including character classes such as
  `[[:alnum:]]`, greedy quantifiers (`*`, `+`, `?`, `{n,m}`), `^`, `$`.
- **Rejected at bootstrap**, with a message saying how to rewrite the pattern: any flags (e.g.
  `/orders/i`), `(?` groups (non-capturing groups, lookaround, inline flags), lazy quantifiers
  (e.g. `*?`), and letter or digit escapes such as `\d`, `\w`, `\s`, `\b` — these either mismatch
  silently or differ between macOS and Linux under POSIX ERE, so the library rejects them outright.
  Use a bracket expression instead, for example `[0-9]` or `[[:alnum:]_]`.
- **A string topic starting with `^`** is rejected at bootstrap too: librdkafka treats any
  subscribed topic string starting with `^` as a regular expression, while the library would
  provision it as a literal topic name. Pass a `RegExp` instead — `/^orders/`, not `'^orders'`.

An unanchored pattern is anchored as `^.*(...)` so it still matches anywhere in the topic name.
Under a namespace, a pattern is rewritten instead to keep the namespace anchored to the start of the
match:

| Input pattern | Namespace `dev` | Form |
| --- | --- | --- |
| `/^orders\..*/` | `/^dev\.(orders\..*)/` | Anchored: `^<ns>\.(...)` |
| `/orders\.[[:alnum:]]+/` | `/^dev\..*(orders\.[[:alnum:]]+)/` | Unanchored: `^<ns>\..*(...)` |

The namespace is regex-escaped before insertion, so a namespace containing `.` cannot widen the
match.

A topic created after a pattern handler has already subscribed is picked up only at the client's
next metadata refresh (default 5 minutes) — plain-string topics, by contrast, are provisioned up
front (see [Topic provisioning](#topic-provisioning)). If the first messages on a newly created
topic matter to a pattern handler, subscribe it with `fromBeginning: true`. To discover new topics
sooner, shorten the refresh interval with the librdkafka property next to `kafkaJS`:

```ts
KafkaModule.register({
  clientOptions: {
    kafkaJS: { brokers: ['kafka:9092'] },
    'topic.metadata.refresh.interval.ms': 60000,
  },
});
```

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
  clientOptions: { kafkaJS: { brokers: ['localhost:9092'] } },
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

Pauses the failing partition, then rethrows. The client logs the error through its own logger and
seeks back to the first unresolved offset, so the same message is redelivered once the partition
resumes — no retry budget, no consumer restart. Only the failing partition pauses: the handler's
other partitions keep flowing while it waits.

The pause grows exponentially with each consecutive failure of the same offset:
`min(initialMs * multiplier ^ attempt, maxMs)`, with `attempt` starting at `0`. The count is kept
per partition and starts over when a different offset fails. Each pause is logged as a warning.

```ts
errorHandling: { type: 'fail' }
errorHandling: { type: 'fail', backoff: { initialMs: 1000, maxMs: 60000, multiplier: 3 } }
errorHandling: { type: 'fail', backoff: false }
```

| `backoff` field | Type | Default | Constraint |
| --- | --- | --- | --- |
| `initialMs` | `number` (ms) | `300` | finite, greater than `0` |
| `maxMs` | `number` (ms) | `30000` | at least `initialMs`, at most `2147483647` |
| `multiplier` | `number` | `2` | finite, at least `1` |

Omitted fields take their defaults. A value that breaks a constraint fails application bootstrap
with an error naming the field. `backoff: false` turns the pause off, so the message is redelivered
immediately, in a tight loop, for as long as it keeps failing. The consumer `retry` options do not
affect this policy.

Delays are minimums: the client picks up a resumed partition on its next fetch cycle, which rounds
short delays up — a `200` ms pause was observed as roughly half a second.

A message that always fails — a poison message — still stalls its partition indefinitely, only more
slowly. Use `dlq` for poison messages, or `ignore` when one bad message must not stall its
partition.

### `{ type: 'ignore' }`

Resolves the offset and moves to the next message. The failure is not recorded
anywhere; the message is not redelivered.

```ts
errorHandling: { type: 'ignore' }
```

### `{ type: 'dlq', topic?: string }`

Produces the original record to a dead-letter topic, then resolves the offset, so the message is
not redelivered.

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

A thrown value that is not an `Error` is recorded as `dlq.error.name: 'Error'` and
`dlq.error.message: String(value)`.

DLQ delivery uses the module's producer. Strategy instances are cached per configuration on the
consumer, so a strategy is shared across every handler that declares the same policy.

**Known limitation: handlers cannot see headers.** `@Message` handlers receive `key` and `value`
only — the consumed record's headers are not exposed through `MessageType`. A handler subscribed to
a DLQ topic through this library therefore cannot read the `dlq.*` headers above. Inspect them with
a plain client consumer instead.

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
`allowAutoTopicCreation: true`. The client's default partitioner (`murmur2_random`) assigns keyed
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

- **One client consumer per handler, in its own consumer group.** Each `@Message` method gets its
  own consumer, created, connected, and run at application bootstrap. Handlers of one connector
  cannot share a `groupId`: the Kafka consumer group protocol assigns a group's partitions only for
  the topics its members subscribed to, so a shared group across different topics silently starves
  one handler, and on the same topics it splits the messages between two different methods.
  Bootstrap fails instead; see [`@Message` options](#message-options).
- **Offsets are resolved manually.** Consumers run with `eachBatchAutoResolve: false`. Within a
  batch, each message is parsed, passed to the handler, and only then is its offset resolved. A
  failing message never has its offset resolved by the framework — that decision belongs to the
  error policy.
- **Batches stop early when the consumer is stopping or the assignment is stale.** Before each
  message the loop checks `isRunning()` and `isStale()` and breaks out, leaving the remaining
  offsets unresolved for redelivery.
- **Bootstrap waits for group assignment, for handlers with at least one plain-string topic.**
  Before such a handler's consumer starts consuming, application bootstrap waits for it to join its
  group and receive its first partition assignment (which may be empty). Expect roughly one
  heartbeat interval when other replicas of this service are already members of the group. A
  handler subscribed only to `RegExp` patterns does not wait: librdkafka sends no `JoinGroup` while
  a subscription matches no existing topic, so bootstrap would otherwise block until the join
  timeout elapses and then fail. Such a handler starts consuming once the client's own metadata
  refresh (`'topic.metadata.refresh.interval.ms'`, default `300000`, settable at the top level of
  `clientOptions`) notices a
  topic matching its pattern. With `fromBeginning: false` (the default), a partition with no
  committed offset starts at the log end as of that assignment. Messages produced after bootstrap
  are delivered to the consumer that holds the partition; until the group's first commit, a
  partition that changes owner — for example a second replica joining, or a crash before the first
  commit — starts again at the log end, as `latest` always did. A committed offset, including `0`,
  is always honoured instead. If no assignment arrives within `rebalanceTimeout + sessionTimeout`
  (defaults `300000 + 30000` ms) for a handler that waits, bootstrap fails with an error naming the
  consumer group. If the client reports a group or topic authorization failure during the wait,
  bootstrap fails immediately instead, with an error naming the consumer group and the broker's
  reason. This reserves librdkafka's `rebalance_cb` consumer property; do not set it
  yourself.
- **A failed bootstrap releases every connection it opened.** If any handler's `subscribe()` call
  ultimately throws, the module disconnects every consumer it had already opened — not only the one
  that failed — and the producer, then rethrows the original error out of `onApplicationBootstrap`,
  which fails Nest application bootstrap. No Kafka connection from this module is left open after a
  failed bootstrap. Note that Nest's `app.close()` on a context whose `init()` failed rethrows that
  same error without running shutdown hooks (true on both Nest 11 and 12), so a host or test that
  catches the bootstrap error should not rely on `close()` to clean up further.
- **Shutdown closes consumers before the producer.** `onModuleDestroy` cancels every pending `fail`
  backoff, so no paused partition resumes afterwards, then disconnects every consumer and logs any
  that fail; `beforeApplicationShutdown`, which Nest runs after every destroy hook,
  then disconnects the producer. DLQ publishes and producer calls made from handlers therefore
  still have a connected producer while the consumers stop. Call `app.enableShutdownHooks()` in the
  host application so these run on `SIGTERM` and `SIGINT`.

### Topic provisioning

Before each handler's consumer is created, the library lists the broker's topics and creates any
missing plain-string topics itself through the admin API, using the broker's default partition
count and replication factor, with a 30 second create timeout. `RegExp` subscriptions are never
provisioned this way — a pattern matches whatever topics already exist, or come to exist later (see
[Pattern (RegExp) topics](#pattern-regexp-topics)).

This happens even when the broker has `auto.create.topics.enable=false`, and needs Create
permission on those topics for the application's Kafka principal. The reason: the client's consumer
does not create a topic on subscribe, and only notices a topic created after that point at its next
metadata refresh — so without this step, a handler subscribing to a brand-new topic could sit idle
indefinitely.

Creating a topic returns before the broker reports it in metadata, and a consumer that subscribes in
that window sees an unknown topic and does not join its group until the next refresh. So after
creating topics, the library waits until the broker reports a leader for every partition of each
one before the handler's consumer subscribes. If that takes longer than 30 seconds, bootstrap fails:

```
Topic(s) orders.created were created but did not become available within 30000 ms: the broker does not yet report a leader for every partition. Check the cluster's health, or create the topics before the application starts.
```

With `allowAutoTopicCreation: false`, the library asserts the topics already exist instead of
creating them, and bootstrap fails if they do not:

```
Topic(s) orders.created do not exist and allowAutoTopicCreation is false. Create them before the application starts, or enable allowAutoTopicCreation.
```

DLQ topics are not provisioned this way. A DLQ topic is created by the producer on its first send,
and only if the broker allows auto-creation (`auto.create.topics.enable=true`) — create it up front
when the broker does not.

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
