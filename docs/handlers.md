# Handlers

A handler is a method on any provider in the application, marked with `@Message(topics, options)`.
Handlers are discovered application-wide on bootstrap, not scoped to the module that declares them,
and each one is subscribed to its own Kafka consumer in its own consumer group.

```ts
@Message(['orders.created'], {
  groupId: 'orders-service',
  errorHandling: { type: 'dlq' },
})
async handleOrderCreated(
  message: MessageType<OrderCreated>,
  context: MessageContext,
): Promise<void> {}
```

The full option list is in [Configuration](configuration.md#message-options).

## Required options

Every handler needs an array of topics holding at least one non-empty topic name or `RegExp`, a
`groupId` that is a non-empty string, and `errorHandling` whose `type` is `fail`, `ignore`, `dlq` or
`retry`; see [Error handling](error-handling.md). TypeScript checks the types. `@Message` and
`@MessageBatch` also check the values, empty ones included, when the class is defined. A JavaScript
host or a cast options object therefore fails early, with an error naming the handler as
`ClassName.methodName` and the option to fix.

## The message

`message.value` is the decoded record value, as described in [Message formats](message-formats.md).
`message.key` is an object when the record key is a JSON object, otherwise the raw UTF-8 string, or
`null` when the record has no key; see [Message formats](message-formats.md#json).

`message.headers` holds the record's headers as `MessageHeaders`
(`Record<string, string | string[]>`). Every value is decoded as UTF-8, so bytes that are not valid
UTF-8 become U+FFFD. A header that appears more than once on the record is an array of its values in
record order. A record without headers gives `{}`.

## The context

The second argument tells the handler where the record was read from:

```ts
type MessageContext = {
  topic: string;
  partition: number;
  offset: string;
  timestamp: string;
};
```

`topic` is the concrete topic the record was consumed from, including the namespace prefix, also
when the handler subscribed with a `RegExp`. `offset` and `timestamp` are strings as the client
reports them: the 64-bit offset, and the record timestamp in epoch milliseconds. A handler that does
not need the context can leave the parameter out.

## Batch handlers

`@MessageBatch(topics, options)` takes the same options as `@Message` and marks a method that receives
the decoded messages of one client batch at once, for bulk writes such as database upserts or search
indexing.

```ts
@MessageBatch(['orders.created'], {
  groupId: 'orders-indexer',
  errorHandling: { type: 'dlq' },
})
async index(batch: ReceivedMessage<MessageType<OrderCreated>>[]): Promise<void> {
  await this.search.bulkIndex(batch.map(({ message }) => message.value));
}
```

Each entry is `{ message, context }`, with the same message and context a `@Message` handler gets. A
batch holds messages of one topic partition, in offset order. A method carries one of the two
decorators, never both, and batch handlers share the one-group-id-per-handler rule with `@Message`
handlers.

How failures are handled is described in [Error handling](error-handling.md#batch-handlers).

### Batch size

A batch holds at most 32 messages, the client's default. The library does not offer a way to
change that yet.

The size is an upper bound, not a target. The client's cache starts at one message after an
assignment and grows with throughput, so right after startup or under light traffic a batch can
hold a single message. With `partitionsConsumedConcurrently` above `1`, batches of different
partitions reach the handler concurrently.

## Provider scope

A handler's provider must be a singleton, and so must every provider it injects. A Kafka message has
no request to scope an instance to, so a `@Message` handler on a request-scoped or transient
provider, or on a provider that depends on a request-scoped one, fails application bootstrap with an
error naming the handler and its scope.

## One group id per handler

Within one connector, two `@Message` handlers that declare the same `groupId` fail application
bootstrap before any consumer connects, with an error naming the group id and both handlers as
`ClassName.methodName`. Handlers registered on different connectors (different `connectorName`s)
are checked separately.

The Kafka consumer group protocol assigns a group's partitions only for the topics its members
subscribed to, so a group shared across different topics would silently starve one handler, and on
the same topics it would split the messages between two different methods.

The same check catches a handler class provided more than once — listed in the `providers` of
more than one module, or under a second token with `useClass`: each creates its own instance, which
would consume the topic twice. That failure says so and asks you to provide the class exactly once.
Aliasing a handler with `useExisting` is not a second registration and subscribes once.

To keep the number of consumer groups down, give one handler every topic it treats the same way:
`@Message` takes an array of topics and `RegExp` patterns, and the context carries the topic each
message came from. See
[Cost of one consumer group per handler](delivery-semantics.md#cost-of-one-consumer-group-per-handler).
