# Design: publishable 0.1.0

Date: 2026-09-16
Status: approved for planning
Branch: `feat/publishable-0-1-0`

## Goal

Turn `nestjs-kafka-connector` from a compiler-verified private repository into a published npm
package that a stranger can install, trust, and use. The deliverable of this design is a released
`0.1.0` whose two distinguishing claims are true and demonstrated against a real broker.

## Positioning

Two capabilities justify this package existing alongside `@nestjs/microservices`:

1. **Per-handler failure policy.** `fail`, `ignore`, or `dlq` chosen per `@Message` handler, with the
   original topic, error name, error message, stack, and timestamp written as headers on the DLQ
   record. `@nestjs/microservices` is built around request-reply and offers nothing equivalent.
2. **Topic namespacing for a cluster shared between environments.** A single `namespace` confines an
   application's produced and consumed topics and its consumer group ids to one prefix, so several
   stands can share one Kafka cluster.

Landscape check performed 2026-09-16. No competing package offers topic namespacing:
`@nest-native/kafka`, `nestjs-kafkajs`, `@rob3000/nestjs-kafka`, and
`@tawk.to/nestjs-batch-kafka` do not mention it. `@jescrich/nestjs-kafka-client` documents
environment-specific broker configuration, which is a different concern. `@nestjs/microservices`
`KafkaOptions` exposes only `postfixId`, which postfixes the client id and never touches topics.

`@nestjs/microservices` 12.0.3, published 2026-09-15, still types its Kafka options with `kafkajs`
`KafkaConfig` and `ConsumerConfig`. Building on `kafkajs` is therefore consistent with the framework's
own transport and is not treated as a defect in this design.

## Non-goals

Explicitly out of scope for 0.1.0, to be reconsidered only after a release exists:

- Sharing one kafkajs consumer across handlers with the same group id (improvement plan item 8).
  It changes rebalance behaviour and cannot be validated before the integration harness of Phase C
  exists.
- A `RETRY_THEN_DLQ` error policy (improvement plan item 11).
- A second adapter on `@confluentinc/kafka-javascript`.
- Any change to the manual offset handling model. `eachBatchAutoResolve: false` stays.

## Decisions

### D1 — Consumer group id must not gain a stray separator

`kafka-consumer.ts` builds `groupId: [this.namespace, consumerGroupId].join('-')`. With no namespace
configured this evaluates to `-orders-service`. Joining is changed to drop absent parts, so an
application without a namespace gets `orders-service` and one with namespace `dev` gets
`dev-orders-service`.

This is corrected before publication because changing a consumer group id after release resets
consumer offsets for every adopter.

### D2 — Namespacing becomes symmetric, owned by one unit

Today `KafkaProducer` prefixes topics inline with `${namespace}.${topic}` while `KafkaConsumer`
subscribes to raw patterns. A namespaced application therefore produces to `dev.orders.created` and
listens on `orders.created`, and never receives its own messages.

A `TopicNamespacer` owns the rule in one place and is injected into both the producer and the
consumer:

```ts
apply(topic: string): string
applyPattern(pattern: string | RegExp): string | RegExp
```

With no namespace configured both methods return their argument unchanged.

**String topics.** `apply` prepends `${namespace}.` unconditionally. There is no detection of an
already-prefixed topic: a caller that passes `dev.orders.created` under namespace `dev` gets
`dev.dev.orders.created`. Explicit beats magical, and the behaviour is tested and documented.

**Pattern topics.** The namespace is escaped for regular-expression use before it is inserted, so a
namespace containing `.` cannot widen the match. The remaining source is wrapped in a non-capturing
group, which preserves existing capture-group numbering and prevents top-level alternation from
escaping the prefix. Flags are preserved.

| Input pattern | Namespace `dev` | Reason |
|---|---|---|
| `/^orders\..*/` | `/^dev\.(?:orders\..*)/` | Anchored: the prefix is inserted after `^`. |
| `/orders\.\w+/` | `/^dev\..*(?:orders\.\w+)/` | Unanchored: anchor, prefix, then allow any intermediate segments. |
| `/^orders\|payments/` | `/^dev\.(?:orders\|payments)/` | Without the group this would parse as `(^dev\.orders)\|(payments)` and match another stand's `payments` topic. |

The alternation case is the reason for the non-capturing group and gets its own test. Note that it
changes the meaning of an anchored alternation: `/^orders|payments/` originally matched a bare
`payments` in any position. Confining it to the namespace is the intended reading and is documented.

**Escape hatch.** Consuming or producing a topic owned by another system is opted out per call site:

- `@Message(topics, { namespaced: false })` on the handler.
- `send(topic, message, { key, namespaced })` on the producer.

`namespaced` defaults to `true`.

**DLQ interaction.** The default DLQ topic derives from `payload.batch.topic`, which the broker
already reports in namespaced form, so `dev.orders.created` yields `dev.orders.created.dlq` with no
further work, and a handler with `namespaced: false` yields a raw `.dlq` name. An explicitly
configured `{ type: 'dlq', topic }` is passed through `TopicNamespacer.apply` honouring the same
per-handler `namespaced` flag, so a custom DLQ name cannot silently escape the namespace.

**Namespacing is a convention, not an isolation boundary.** It enforces nothing at the broker; a
handler that opts out still sees other stands' traffic, and nothing prevents another application
from writing into the prefix. The README must state this so it is not mistaken for a security
control.

### D3 — `TransportConnectorModule` becomes `KafkaModule`

The module is renamed. The old name is **not** retained as a deprecated alias: the package has never
been published, so there is no dependant to deprecate it for, and an alias would be dead surface
area on day one. Renamed alongside it, for consistency of the public vocabulary:

| Current | New |
|---|---|
| `TransportConnectorModule` | `KafkaModule` |
| `TransportConnectorModuleOptions` | `KafkaModuleOptions` |
| `TransportConnectorModuleAsyncOptions` | `KafkaModuleAsyncOptions` |
| `TransportConnectorModuleOptionsFactory` | `KafkaModuleOptionsFactory` |
| `createTransportConnectorOptions()` | `createKafkaOptions()` |

`registerAsync` keeps supporting all three of `useFactory`, `useClass`, and `useExisting`.

### D4 — `moduleName` string scoping is replaced by application-wide discovery

`MessageHandlersDiscoveryService` compares `provider.parentModule.name` against a `moduleName`
string supplied by the host. The comparison breaks under class renaming and under any build that
mangles class names, and it fails silently: handlers are simply never subscribed.

Passing the module class instead is not viable, because the host module imports `KafkaModule` while
`KafkaModule` would name the host module, which is a circular reference requiring `forwardRef` at
every call site.

`moduleName` is therefore removed and handlers are discovered application-wide, matching
`@nestjs/schedule` and `@nestjs/event-emitter`. The `'module_name'` provider is deleted.

The hazard this introduces is two registrations of `KafkaModule` each subscribing every discovered
handler, producing duplicate consumption. An optional `connectorName` on both the module options and
`MessageOptions` addresses it: when a module is registered with a `connectorName`, it subscribes only
handlers declaring the same `connectorName`; when it is registered without one, it subscribes only
handlers that declare none. The README documents the multiple-registration case and the option.

### D5 — The kafkajs producer becomes its own provider

`consumerProxyProvider` currently reaches through `producerProxy.producer` to hand a raw kafkajs
`Producer` to the DLQ strategy. That reach-through is why the field is public and why improvement
plan item 12 could not make it private.

The kafkajs `Producer` is promoted to its own provider under a `KAFKA_PRODUCER` token, created once
and injected into both `KafkaProducer` and `KafkaConsumer`. `KafkaProducer` then receives a producer
rather than constructing one, its field becomes `private readonly`, and no caller reaches through
the proxy.

### D6 — Injection tokens become exported constants

While `'module_name'` is being removed, the remaining bare string tokens are replaced with exported
`const` tokens declared in one module: `TRANSPORT_CONFIG`, `TRANSPORT_NAMESPACE`,
`SCHEMA_REGISTRY_OPTIONS`, `CONSUMER_DEFAULTS`, `KAFKA_PRODUCER`. They are internal to the package
and are not added to `index.ts`.

### D7 — Incidental corrections in files already being edited

- `MessageHandlersDiscoveryService` uses `console.error`; it switches to the injected Nest `Logger`.
- `producerProxyProvider` wraps `connect()` in a `try`/`catch` that only rethrows; the wrapper is
  removed.
- `getParseStrategy` is called once per message inside the batch loop, allocating a strategy per
  record. It is resolved once per subscription and passed into the batch handler.
- `/** @default */` blocks in `types/` are stripped from every file touched, per the zero-comments
  rule, with the defaults stated in this document and in the README instead.

## Public API changes

Every item below is breaking relative to the current source and free to make, because nothing has
ever installed the package. None may be deferred past 0.1.0.

- `TransportConnectorModule` and its options types are renamed (D3).
- `moduleName` is removed from the module options; `connectorName` is added as optional (D4).
- `ProducerProxy.send(topic, message, key?)` becomes
  `send(topic, message, options?: { key?: string; namespaced?: boolean })`.
- `MessageOptions` gains optional `namespaced` and `connectorName`.
- Consumer group ids lose their leading separator for applications without a namespace (D1).
- Namespaced applications begin consuming namespaced topics (D2), which is the correction of a
  defect but changes which topics an existing configuration subscribes to.

## Testing strategy

Two Jest projects, so that unit tests run anywhere and broker-dependent tests are opt-in:

- `npm test` — unit, no Docker required.
- `npm run test:integration` — requires a broker.

Unit coverage, written test-first per task:

- `TopicNamespacer`: absent namespace, string prefixing, unconditional double-prefixing, anchored
  pattern, unanchored pattern, top-level alternation, regex-special characters in the namespace,
  flag preservation, capture-group numbering preserved.
- Group id composition with and without a namespace.
- Parse strategies: JSON success, JSON malformed input raising a descriptive error, Avro without a
  configured registry raising the configuration error.
- Error strategies: `fail` propagating, `ignore` resolving the offset, `dlq` publishing to the
  derived topic with each documented header present.
- `subscribe()` configuration precedence: per-handler over module defaults over built-in default,
  field by field, including shallow `retry` merging.
- Discovery against a fake `ConsumerProxy`: handlers found application-wide, `connectorName`
  filtering in both directions, and the defaults applied to an options object that omits them.

Integration coverage against a real broker via Testcontainers:

- Produce, consume, handler invoked, offset resolved.
- Handler throws under `{ type: 'dlq' }`; the record arrives on `${topic}.dlq` carrying
  `dlq.original.topic`, `dlq.error.message`, `dlq.error.name`, and `dlq.timestamp`.
- Namespaced round trip: produce and consume the same logical topic under a namespace. This is the
  test that fails against today's source and proves D2.
- Graceful shutdown disconnects every consumer and the producer.

The local Docker daemon is not currently running; Phase C requires it started.

## Release

- GitHub Actions on push and pull request: `npx tsc --noEmit`, then `npm test`. Integration tests run
  against a broker service container in the same workflow.
- `npm login` is required; the account is not currently authenticated.
- README updated: the new module name, `connectorName`, the `namespaced` escape hatch, the stated
  default for every option, the broker version the integration suite ran against, and an explicit
  statement that namespacing is a convention rather than an isolation boundary.
- Publish `0.1.0` with the pre-1.0 caveat retained: the public API may still change.

## Phases

Each phase is a sequence of small tasks, each ending in a passing test and a focused commit.

| Phase | Content | Done when |
|---|---|---|
| A | Jest and ts-jest, two projects, `test` and `test:integration` scripts, no specs | `npm test` exits zero on an empty suite via `--passWithNoTests` |
| B | D1 through D7, test-first | Unit suite green, `npx tsc --noEmit` clean |
| C | Testcontainers integration suite | The four integration cases pass against a real broker |
| D | CI workflow, README, publish | `0.1.0` resolves on the public registry |

Phase B is ordered D5, D6, D1, D2, D3, D4, D7: the provider rework precedes the behavioural changes
so that later tasks edit already-clean wiring, and the rename lands after the behaviour is correct so
it stays a mechanical diff.

## Constraints carried into every task

- Zero comments in source and tests alike. No `//`, no `/* */`, no JSDoc. The only exception is a
  machine-read directive the codebase already uses.
- `index.ts` is the public contract. Nothing is exported because an internal file needed it.
- Nothing in `base/`, `interfaces/`, `types/`, `decorators/`, or `services/` imports `kafkajs`,
  apart from the existing type-only reuse of `KafkaConfig` and `RetryOptions` in `types/`.
- `@kafkajs/confluent-schema-registry` stays lazily `require`d and optional.
- Do not add `any`; narrow the existing occurrences when already editing the file.
- Match the formatting of the file being edited; do not reformat unrelated lines.
