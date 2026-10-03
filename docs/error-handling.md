# Error handling

Every handler declares an `errorHandling` policy. It applies when the handler method rejects, and
also when parsing the record throws.

| Policy | On failure | Redelivered |
| --- | --- | --- |
| `fail` | pauses the partition with backoff, then retries the same message | yes, until it succeeds |
| `ignore` | resolves the offset and moves on | no |
| `dlq` | publishes the record to a dead-letter topic, then resolves the offset | no |

## `{ type: 'fail' }`

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

## `{ type: 'ignore' }`

Resolves the offset and moves to the next message. The failure is not recorded anywhere; the
message is not redelivered.

```ts
errorHandling: { type: 'ignore' }
```

## `{ type: 'dlq', topic?: string }`

Produces the original record to a dead-letter topic, then resolves the offset, so the message is
not redelivered. DLQ delivery uses the module's producer.

```ts
errorHandling: { type: 'dlq' }
errorHandling: { type: 'dlq', topic: 'orders.failures' }
```

Without `topic`, the destination is the source topic plus a `.dlq` suffix — `orders.created` becomes
`orders.created.dlq`. How DLQ topics are namespaced and created is described in
[Topics and namespacing](topics-and-namespacing.md#dlq-topics).

If the DLQ publish fails, the offset is not resolved and the record is redelivered. A publish to a
missing DLQ topic fails only after about 30 seconds (see [Producing](producing.md#topic)), so each
redelivery stalls the partition for that long.

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

A handler subscribed to a dead-letter topic reads these headers from `message.headers`:

```ts
@Message(['orders.created.dlq'], {
  groupId: 'orders-dead-letters',
  errorHandling: { type: 'ignore' },
})
async handleDeadLetter(message: MessageType<OrderCreated>): Promise<void> {
  this.logger.warn(
    `Order ${message.value?.orderId} failed: ${message.headers?.['dlq.error.message']}`,
  );
}
```
