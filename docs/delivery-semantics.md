# Delivery semantics

**Delivery is at-least-once. Handlers must be idempotent.** A handler can succeed and the process
can die before its offset is committed, in which case the message is delivered again on restart.

## One consumer per handler

Each `@Message` method gets its own client consumer in its own consumer group, created, connected,
and run at application bootstrap. Handlers of one connector cannot share a `groupId`; see
[Handlers](handlers.md#one-group-id-per-handler).

## Offsets

Consumers run with `eachBatchAutoResolve: false`. Within a batch, each message is parsed, passed to
the handler, and only then is its offset resolved. A failing message never has its offset resolved
by the framework — that decision belongs to the
[error policy](error-handling.md).

When the consumer is stopping or its assignment has been revoked, the batch stops early and the
remaining messages are left unresolved for redelivery.

A [batch handler](handlers.md#batch-handlers) is called once per batch; all of its messages are
resolved after it returns, and on failure the policy decides per message, see
[Error handling](error-handling.md#batch-handlers).

## Ordering and concurrency

Ordering is guaranteed per partition only. By default a handler's consumer processes one partition
at a time.

With `partitionsConsumedConcurrently` above `1` (see [`ConsumerConfig`](configuration.md#consumerconfig)),
batches from different partitions run concurrently, up to the number of partitions assigned to the
consumer. Messages within one partition still reach the handler one at a time and in order, and
nothing is ordered across partitions. The `fail` policy's backoff pauses only the failing
partition; the others keep being processed. Because one provider instance serves every partition,
its handler method must be safe to call concurrently.

The value is an upper bound. Only partitions whose messages the client fetched together run
concurrently, so right after startup or under light traffic batches can still run one at a time.

## Start offsets

With `fromBeginning: false` (the default), a partition with no committed offset starts at the log
end as of its assignment. A committed offset, including `0`, is always honoured instead. Retry topics
are the exception: a retry topic partition with no committed offset starts at its log start, see
[Topics and namespacing](topics-and-namespacing.md#retry-topics).

Messages produced after bootstrap are delivered to the consumer that holds the partition. Until the
group's first commit, a partition that changes owner — for example a second replica joining, or a
crash before the first commit — starts again at the log end.

## Bootstrap waits for group assignment

Before a handler with at least one plain-string topic starts consuming, application bootstrap waits
for its consumer to join its group and receive its first partition assignment (which may be empty).
Expect roughly one heartbeat interval when other replicas of this service are already members of the
group.

- If no assignment arrives within `rebalanceTimeout + sessionTimeout` (defaults
  `300000 + 30000` ms), bootstrap fails with an error naming the consumer group.
- If the client reports a group or topic authorization failure during the wait, bootstrap fails
  immediately, with an error naming the consumer group and the broker's reason.

A handler subscribed only to `RegExp` patterns does not wait: librdkafka sends no `JoinGroup` while a
subscription matches no existing topic, so bootstrap would otherwise block until the timeout and
then fail. Such a handler starts consuming once the client's metadata refresh
(`'topic.metadata.refresh.interval.ms'`, default `300000`, settable at the top level of
`clientOptions`) notices a topic matching its pattern.

The wait relies on librdkafka's `rebalance_cb` consumer property, which the library reserves; do
not set it yourself.

## Failed bootstrap

If any handler's subscription fails, the module disconnects every consumer it had already opened —
not only the one that failed — and the producer, then rethrows the original error, which fails Nest
application bootstrap. No Kafka connection from this module is left open.

Nest's `app.close()` on a context whose `init()` failed rethrows that same error without running
shutdown hooks (on both Nest 11 and 12), so a host or test that catches the bootstrap error should
not rely on `close()` to clean up further.

## Shutdown

Consumers close before the producer. `onModuleDestroy` cancels every pending `fail` backoff, so no
paused partition resumes afterwards, then disconnects every consumer and logs any that fail;
`beforeApplicationShutdown`, which Nest runs after every destroy hook, then disconnects the
producer. DLQ publishes and producer calls made from handlers therefore still have a connected
producer while the consumers stop.

Call `app.enableShutdownHooks()` in the host application so these run on `SIGTERM` and `SIGINT`.

## Cost of one consumer group per handler

Every `@Message` handler is an independent subscription: its own client consumer in its own consumer
group. That keeps handlers isolated at the Kafka level — one handler's paused partition, lag, or
rebalance stays inside its own group — but every cost below is paid once per handler, in every
replica of the service. A service with 40 handlers running as 3 replicas runs 120 consumers in 40
groups.

- **Connections and threads.** Each handler's consumer is a separate librdkafka client instance,
  with its own broker connections, background threads, and prefetch queue; the module's producer is
  the only client they share. When its topics have a backlog, each consumer prefetches about
  `queued.max.messages.kbytes` (librdkafka default `65536`, 64 MiB) into memory.
- **Steady-state traffic.** Each consumer heartbeats to its group coordinator every
  `heartbeatInterval` (client default `3000` ms) and keeps sending fetch requests to the brokers
  that lead its partitions, whether or not messages are arriving.
- **Rebalances on every deploy.** A replica that stops leaves each of its groups, and one that
  starts joins each of them, so a rolling deploy rebalances every group up to twice per replica.
  The client's default assignor is `roundrobin`, which is eager: while a group rebalances, all of its
  members stop consuming until the new assignment arrives. With `fromBeginning: false` (the
  default), every non-empty assignment also costs admin round trips before consumption resumes: the
  library fetches the group's committed offsets, and the log-end offsets of partitions that have
  none, through an admin client that shares the consumer's connections.
- **Bootstrap time.** Handlers subscribe concurrently, so bootstrap takes about as long as the
  slowest handler rather than the sum of all of them. For each handler with a plain-string topic,
  that is an admin client connecting to list (and possibly create) topics, the consumer connecting,
  and the wait for its first assignment. All of those happen at once, so the brokers and group
  coordinators see a burst of connections, metadata requests, and group joins proportional to the
  number of handlers.

None of this has a fixed threshold. It starts to hurt when deploys spend noticeable time in
rebalances, when bootstrap stretches as handlers wait on group joins, when memory grows with
backlogged consumers, or when the broker's connection count or group count becomes something you
have to manage — typically as handlers per service climb into the dozens, multiplied by replicas.

To keep the count down, give one handler every topic it treats the same way: `@Message` takes an
array of topics and `RegExp` patterns, and the handler's context carries the topic each message came
from.
