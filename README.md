# nestjs-kafka-connector

[![CI](https://github.com/mannkostir/nestjs-kafka/actions/workflows/ci.yml/badge.svg)](https://github.com/mannkostir/nestjs-kafka/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/nestjs-kafka-connector)](https://www.npmjs.com/package/nestjs-kafka-connector)
[![license](https://img.shields.io/npm/l/nestjs-kafka-connector)](https://github.com/mannkostir/nestjs-kafka/blob/main/LICENSE)

Decorator-driven Kafka consumers and producer for NestJS, built on
[`@confluentinc/kafka-javascript`](https://github.com/confluentinc/confluent-kafka-javascript)
(librdkafka). Mark any provider method with `@Message(...)`; the module discovers it on bootstrap
and subscribes it to its own Kafka consumer.

**Status: pre-1.0 (`0.2.1`).** The public API may still change between versions.
Integration-tested against `confluentinc/cp-kafka:7.6.1` in KRaft mode.

## Features

- **Decorator handlers** — `@Message(topics, options)` on any singleton provider, each handler in
  its own consumer group.
- **Error policies** — `fail` with per-partition exponential backoff, `ignore`, or `dlq` with error
  details in headers.
- **Message formats** — JSON, enveloped JSON, and Avro via Confluent Schema Registry.
- **Namespacing** — one `namespace` option prefixes topics and group ids, so several environments
  can share a cluster.
- **Explicit offsets** — resolved only after the handler succeeds; at-least-once delivery.
- **Topic provisioning** — missing topics are created before a handler subscribes.
- **NestJS 11 and 12**, ES module and CommonJS hosts, zero runtime dependencies.

## Compared with `@nestjs/microservices`

| | This library | `@nestjs/microservices` (Kafka transport) |
| --- | --- | --- |
| Bootstrap | A plain dynamic module in any Nest application | A dedicated microservice or a hybrid app |
| Consumer groups | One per `@Message` handler | One `groupId` for the whole server |
| Dead-letter routing | Built-in `dlq` policy | Hand-rolled exception filter |
| Avro / schema registry | Built-in | Not documented |
| Offsets on handler failure | Per the `fail`, `ignore`, `dlq` policies | Auto-commit by default; manual commit via `KafkaContext` |
| Topic namespacing | Built-in, symmetric for topics and group ids | Not documented |
| Underlying client | `@confluentinc/kafka-javascript` (librdkafka) | `kafkajs` |

Use Nest's transport instead if you need request-reply over Kafka (`@MessagePattern` with a reply
topic), want one codebase to switch between transports, or prefer first-party support.

## Installation

```sh
npm install nestjs-kafka-connector @confluentinc/kafka-javascript
```

Peers: `@nestjs/common` and `@nestjs/core` `^11 || ^12`, `@confluentinc/kafka-javascript ^1.10`,
`reflect-metadata ^0.2`. For Avro, also install the optional peer
`@kafkajs/confluent-schema-registry`.

Requires Node.js `^20.19.0` or `>=22.12.0`. Module formats, TypeScript settings, and Jest setup are
covered in
[Compatibility](https://github.com/mannkostir/nestjs-kafka/blob/main/docs/compatibility.md).

## Quickstart

Register the module:

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

Declare a handler on any provider in the application:

```ts
import { Injectable, Logger } from '@nestjs/common';
import { Message, MessageContext, MessageType } from 'nestjs-kafka-connector';

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
    context: MessageContext,
  ): Promise<void> {
    const order = message.value;

    if (!order) {
      return;
    }

    this.logger.log(
      `Order ${order.orderId} received from ${context.topic}, partition ${context.partition}, offset ${context.offset}`,
    );
  }
}
```

Publish by injecting `ProducerProxy`:

```ts
import { Injectable } from '@nestjs/common';
import { ProducerProxy } from 'nestjs-kafka-connector';

@Injectable()
export class OrderPublisher {
  constructor(private readonly producer: ProducerProxy) {}

  async publishCreated(orderId: string, total: number): Promise<void> {
    await this.producer.send('orders.created', {
      key: null,
      value: { orderId, total },
    });
  }
}
```

Delivery is at-least-once, so handlers must be idempotent. Call `app.enableShutdownHooks()` so
consumers and the producer disconnect cleanly on `SIGTERM`.

## Documentation

- [Configuration](https://github.com/mannkostir/nestjs-kafka/blob/main/docs/configuration.md) —
  module options, `registerAsync`, multiple connectors, `@Message` options, consumer settings and
  their precedence.
- [Handlers](https://github.com/mannkostir/nestjs-kafka/blob/main/docs/handlers.md) — the message,
  its headers and context, provider scope, and why each handler needs its own `groupId`.
- [Topics and namespacing](https://github.com/mannkostir/nestjs-kafka/blob/main/docs/topics-and-namespacing.md)
  — namespace rules, `RegExp` subscriptions and their POSIX syntax, and topic provisioning.
- [Message formats](https://github.com/mannkostir/nestjs-kafka/blob/main/docs/message-formats.md) —
  JSON, enveloped JSON, and Avro.
- [Error handling](https://github.com/mannkostir/nestjs-kafka/blob/main/docs/error-handling.md) —
  the `fail`, `ignore`, and `dlq` policies, backoff, and dead-letter headers.
- [Producing](https://github.com/mannkostir/nestjs-kafka/blob/main/docs/producing.md) — `send()`,
  keys, headers, and value encoding.
- [Delivery semantics](https://github.com/mannkostir/nestjs-kafka/blob/main/docs/delivery-semantics.md)
  — offsets, start positions, bootstrap and shutdown behaviour, and the cost of one consumer group
  per handler.
- [Compatibility](https://github.com/mannkostir/nestjs-kafka/blob/main/docs/compatibility.md) —
  peer ranges, module formats, Node.js versions, TypeScript, and Jest.

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

## License

[MIT](https://github.com/mannkostir/nestjs-kafka/blob/main/LICENSE)
