# nestjs-kafka-connector

A NestJS dynamic module that wires a Kafka client, a producer, a consumer, and decorator-driven
message-handler discovery into a host application. Handlers are ordinary provider methods marked
with `@Message(...)`; the module discovers them on application bootstrap and subscribes each one to
its own Kafka consumer.

Messages are parsed by a pluggable strategy (JSON or Avro via Confluent Schema Registry), and
per-handler failures are routed through a pluggable error policy (`fail`, `ignore`, or `dlq`).

**Status: pre-1.0 (`0.1.0`). Not published to npm.** The public API may change between versions.

## Quickstart

Register the module in the same module that declares your handler providers:

```ts
import { Module } from '@nestjs/common';
import { TransportConnectorModule } from 'nestjs-kafka-connector';
import { OrderEventsHandler } from './order-events.handler';

@Module({
  imports: [
    TransportConnectorModule.register({
      moduleName: 'OrdersModule',
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

`moduleName` is the class name of the module whose providers are scanned for handlers, given as a
string. Discovery compares it against each provider's parent module name, so a handler is only
subscribed when it is a provider of that module and the string matches the class name exactly.

Declare a handler as a method on any provider of that module:

```ts
import { Injectable } from '@nestjs/common';
import { Message, MessageType } from 'nestjs-kafka-connector';

type OrderCreated = { orderId: string; total: number };

@Injectable()
export class OrderEventsHandler {
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

    await this.fulfil(order.orderId);
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

`TransportConnectorModule.register(options)` accepts:

| Option | Type | Required | Description |
| --- | --- | --- | --- |
| `clientOptions` | `KafkaConfig` (kafkajs) | yes | Passed straight to `new Kafka(...)`: `brokers`, `clientId`, `ssl`, `sasl`, and the rest. |
| `moduleName` | `string` | yes | Class name of the module whose providers are scanned for `@Message` handlers. |
| `namespace` | `string` | no | Prefixes produced topics and consumer group ids. See [Topics, namespace, and group ids](#topics-namespace-and-group-ids). |
| `schemaRegistry` | `{ url: string }` | no | Enables Avro. Constructs a `SchemaRegistry` against `url`. |
| `consumerDefaults` | `ConsumerConfig` | no | Consumer settings applied to every handler unless overridden per handler. |

### Asynchronous registration

`registerAsync` supports `useFactory`, `useClass`, and `useExisting`, and accepts `imports` and
`inject`.

```ts
TransportConnectorModule.registerAsync({
  imports: [ConfigModule],
  inject: [ConfigService],
  useFactory: (config: ConfigService) => ({
    moduleName: 'OrdersModule',
    namespace: config.get('KAFKA_NAMESPACE'),
    clientOptions: {
      clientId: config.get('KAFKA_CLIENT_ID'),
      brokers: config.get<string>('KAFKA_BROKERS').split(','),
    },
  }),
});
```

`useClass` and `useExisting` take a class implementing `TransportConnectorModuleOptionsFactory`:

```ts
import { Injectable } from '@nestjs/common';
import {
  TransportConnectorModuleOptions,
  TransportConnectorModuleOptionsFactory,
} from 'nestjs-kafka-connector';

@Injectable()
export class KafkaConfigFactory implements TransportConnectorModuleOptionsFactory {
  createTransportConnectorOptions(): TransportConnectorModuleOptions {
    return {
      moduleName: 'OrdersModule',
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

### `ConsumerConfig`

The same shape is used for module-wide `consumerDefaults` and per-handler `consumer` overrides.

| Field | Type | Default |
| --- | --- | --- |
| `fromBeginning` | `boolean` | `false` |
| `heartbeatInterval` | `number` (ms) | `30000` |
| `allowAutoTopicCreation` | `boolean` | `true` |
| `sessionTimeout` | `number` (ms) | unset — kafkajs applies its own (`30000`) |
| `rebalanceTimeout` | `number` (ms) | unset — kafkajs applies its own (`60000`) |
| `retry` | `Partial<RetryOptions>` (kafkajs) | see below |

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
TransportConnectorModule.register({
  moduleName: 'OrdersModule',
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

`namespace` is applied at three points, and they are not symmetrical:

- **Produced topics are prefixed.** `producer.send('orders.created', ...)` with `namespace: 'acme'`
  writes to `acme.orders.created`. Without a namespace it writes to `orders.created`.
- **Consumed topics are not prefixed.** The consumer subscribes to the `topicPatterns` given to
  `@Message` exactly as written. To consume what a namespaced producer wrote, name the full topic:
  `@Message(['acme.orders.created'], ...)`.
- **Group ids are joined with a dash.** The effective group id is `[namespace, groupId].join('-')`.
  With `namespace: 'acme'` and `groupId: 'orders-service'` it is `acme-orders-service`. With no
  namespace it is `-orders-service`.

DLQ records are produced through the raw kafkajs producer, so DLQ topic names are not prefixed with
the namespace either.

## Message formats

### JSON

`MessageFormat.JSON` is the default and needs no extra configuration.

The record value is read as UTF-8 and passed through `JSON.parse` into a `{ payload }` envelope,
which is the shape `ProducerProxy.send` writes. If the parse throws, `message.value` is `null` — the
handler is still invoked. If the parsed envelope's `payload` is itself a string, it is parsed a
second time, which accommodates producers that stringify the payload separately.

The record key is read as UTF-8 and passed through `JSON.parse`, so keys on the wire are expected to
be JSON.

```ts
message.key;
message.value;
message.value?.payload;
message.headers;
```

### Avro

Supply a registry URL at module registration and install `@kafkajs/confluent-schema-registry`:

```ts
TransportConnectorModule.register({
  moduleName: 'OrdersModule',
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

The record value is decoded by the registry. The record key is read as UTF-8 and `JSON.parse`d, the
same as in JSON mode.

Declaring an Avro handler without `schemaRegistry` options throws at bootstrap with a message
naming both the option and the package to install. Producing is JSON-only: `ProducerProxy.send`
always stringifies the value.

## Error handling

Every handler declares an `errorHandling` policy. It applies when the handler method rejects, and
also when parsing the record throws.

### `{ type: 'fail' }`

Rethrows. The offset is not resolved, so the batch is retried according to the consumer's `retry`
configuration and the message is redelivered.

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

## Producing

`ProducerProxy` is connected eagerly during module initialisation; a broker that is unreachable at
startup fails module construction.

```ts
send(topic: string, message: MessageType<TPayload>): Promise<unknown>;
```

The record's `value` is `JSON.stringify(message.value)` and its `headers` are `message.headers`. The
record key is not taken from `message.key`. Topics are namespace-prefixed as described above, and
the underlying producer is created with `allowAutoTopicCreation: true`.

```ts
await this.producer.send('orders.created', {
  key: null,
  value: { payload: { orderId: 'ord_1', total: 4200 } },
  headers: { 'x-correlation-id': correlationId },
});
```

## Delivery semantics

**Delivery is at-least-once. Handlers must be idempotent.** A handler can succeed and the process
can die before its offset is committed, in which case the message is delivered again on restart.

- **One kafkajs consumer per handler.** Each `@Message` method gets its own consumer, created,
  connected, and run at application bootstrap. Two handlers sharing a `groupId` still join as two
  members of that group.
- **Offsets are resolved manually.** Consumers run with `eachBatchAutoResolve: false`. Within a
  batch, each message is parsed, passed to the handler, and only then is its offset resolved,
  followed by a heartbeat. A failing message never has its offset resolved by the framework — that
  decision belongs to the error policy.
- **Batches stop early when the consumer is stopping or the assignment is stale.** Before each
  message the loop checks `isRunning()` and `isStale()` and breaks out, leaving the remaining
  offsets unresolved for redelivery.
- **Shutdown closes connections.** `beforeApplicationShutdown` disconnects every consumer and logs
  any that fail; `onModuleDestroy` disconnects the producer. Call `app.enableShutdownHooks()` in the
  host application so these run on `SIGTERM` and `SIGINT`.
