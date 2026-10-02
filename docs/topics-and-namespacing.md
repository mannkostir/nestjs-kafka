# Topics and namespacing

## Namespace

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

**Namespacing is a convention, not an isolation boundary.** It enforces nothing at the broker: a
handler that opts out of namespacing still sees another stand's traffic on the same broker, and
nothing prevents another application from writing into your namespace's prefix. Use it to let
several environments or stands share one Kafka cluster without topic collisions by convention, not
as a security or access control.

## Opting out per call site

Consuming or producing a topic owned by another system — one that must not be namespaced — is
opted out per call site:

- `@Message(topics, { namespaced: false })` on the handler.
- `send(topic, message, { namespaced: false })` on the producer.

`namespaced` defaults to `true` in both places.

## DLQ topics

An explicitly configured DLQ topic (`errorHandling: { type: 'dlq', topic: 'orders.failures' }`) is
namespaced the same way as any other topic, honouring the handler's own `namespaced` flag. The
default DLQ topic (no `topic` given, derived as `${originalTopic}.dlq`) inherits the namespace
naturally, because it is derived from the topic the broker actually reported the record on, which
is already namespaced when the source subscription was.

## Pattern (RegExp) topics

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

## Topic provisioning

Before each handler's consumer is created, the library lists the broker's topics and creates any
missing plain-string topics itself through the admin API, using the broker's default partition
count and replication factor, with a 30 second create timeout. `RegExp` subscriptions are never
provisioned this way — a pattern matches whatever topics already exist, or come to exist later.

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
