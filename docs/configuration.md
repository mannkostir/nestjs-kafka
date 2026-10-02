# Configuration

## Module options

`KafkaModule.register(options)` accepts:

| Option | Type | Required | Description |
| --- | --- | --- | --- |
| `clientOptions` | `KafkaJS.CommonConstructorConfig` (`@confluentinc/kafka-javascript`) | yes | Passed straight to `new KafkaJS.Kafka(...)`. KafkaJS-compatible options — `brokers`, `clientId`, `ssl`, `sasl`, and the rest — go under `kafkaJS`: `{ kafkaJS: { brokers, clientId, ssl, sasl } }`. librdkafka properties (e.g. `'socket.keepalive.enable'`) sit alongside `kafkaJS`, outside that block. |
| `namespace` | `string` | no | Prefixes produced and consumed topics and consumer group ids. See [Topics and namespacing](topics-and-namespacing.md). |
| `connectorName` | `string` | no | Scopes handler discovery when `KafkaModule` is registered more than once in the same app. See [Registering more than once](#registering-more-than-once). |
| `schemaRegistry` | `{ url: string }` | no | Enables Avro. Constructs a `SchemaRegistry` against `url`. |
| `consumerDefaults` | `ConsumerConfig` | no | Consumer settings applied to every handler unless overridden per handler. |
| `messageFormat` | `MessageFormat` | no | Default format for every consumer and for the producer. Defaults to `MessageFormat.JSON`. A handler's `@Message({ messageFormat })` and a send's `{ messageFormat }` override it. See [Message formats](message-formats.md). |

`namespace` and `connectorName` must not be empty strings: `''` fails module construction with an
error saying so. Leave either option `undefined` to opt out of it; this matters most when the value
comes from an environment variable that may be set but empty.

Handler consumers, and the admin client each one uses to pin its start offsets, log through Nest's
`Logger` with the context `KafkaClient`. The producer and the admin client that provisions topics
log through the client's own default logger. Pass `clientOptions.kafkaJS.logger` to route all of
them elsewhere.

`ConsumerProxy` and `ProducerProxy` are the module's only exported providers.

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
| `errorHandling` | `MessageErrorHandlingConfig` | yes | — |
| `messageFormat` | `MessageFormat` | no | the module's `messageFormat`, then `MessageFormat.JSON` |
| `consumer` | `ConsumerConfig` | no | falls back to `consumerDefaults` |
| `namespaced` | `boolean` | no | `true` |
| `connectorName` | `string` | no | `undefined` — matches an unnamed module registration |

`errorHandling` is described in [Error handling](error-handling.md). Each handler needs its own
`groupId`; see [Handlers](handlers.md#one-group-id-per-handler).

## `ConsumerConfig`

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
so the client's own defaults apply. Keep `heartbeatInterval` well below the effective
`sessionTimeout`, as Kafka requires. `rebalanceTimeout` maps to librdkafka's
`max.poll.interval.ms`; bootstrap's wait for group assignment (see
[Delivery semantics](delivery-semantics.md#bootstrap-waits-for-group-assignment)) is bounded by
`rebalanceTimeout + sessionTimeout`.

`retry` is `KafkaJS.RetryOptions`: `maxRetryTime`, `initialRetryTime`, `retries`. Defaults are
`maxRetryTime: 30000` and `initialRetryTime: 300`. `factor`, `multiplier`, and `restartOnFailure`
are not configurable — the client fixes them (`0.2`, `2`, and always-restart respectively) and
throws if you set them. `retries` is read only for produce requests; setting it in a handler's or
module's consumer `retry` has no effect on that consumer.

`allowAutoTopicCreation` controls [topic provisioning](topics-and-namespacing.md#topic-provisioning).

## Precedence

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
