# Message formats

The format is chosen per module with `messageFormat`, and overridden per handler with
`@Message({ messageFormat })` and per send with `{ messageFormat }`. It defaults to
`MessageFormat.JSON`.

## JSON

`MessageFormat.JSON` is the default and needs no extra configuration.

The record value is read as UTF-8 and passed through `JSON.parse`. The handler receives the parsed
value as-is — an object, array, string, number or boolean — with no envelope. A JSON string value
stays a string and is not parsed again. A record without a value and the JSON literal `null` both
give `value: null`.

**A malformed value raises.** If `JSON.parse` fails on the record value, parsing throws a
descriptive error instead of silently producing `value: null`. The error is routed through the
handler's configured `errorHandling` policy like any other failure, so a handler declaring
`{ type: 'dlq' }` dead-letters the poison record instead of ever seeing it.

**Keys decode leniently.** The record key is read as UTF-8 and parsed as JSON when that succeeds;
when it does not, the raw string is used as the key instead of raising. Kafka keys are untyped
bytes, so both branches yield a usable key.

## Enveloped JSON

`MessageFormat.ENVELOPED_JSON` reads and writes the `{ "payload": … }` wire format of earlier
releases. The handler receives the unwrapped `payload` as `message.value`, so handler code is the
same as with `JSON`; sends wrap `message.value` in the envelope. A string `payload` is parsed as
JSON a second time, which accommodates producers that stringify the payload separately. A string
value is therefore written JSON-encoded inside the payload, so it reads back as the same string.

A record without a value gives `value: null`, and so does a value whose bytes are the JSON literal
`null`. A record whose value is anything else that is not an object with a `payload` property,
such as `{}` or an array, raises and goes through the handler's `errorHandling`.

Use it module-wide:

```ts
KafkaModule.register({
  clientOptions: { kafkaJS: { brokers: ['localhost:9092'] } },
  messageFormat: MessageFormat.ENVELOPED_JSON,
});
```

Override it for one topic on a handler and on a send, so the topic can move to plain JSON once its
producers and consumers agree:

```ts
@Message(['orders.created'], {
  groupId: 'orders-service',
  messageFormat: MessageFormat.JSON,
  errorHandling: { type: 'dlq' },
})
async handleOrderCreated(message: MessageType<OrderCreated>): Promise<void> {}
```

```ts
await this.producer.send(
  'orders.created',
  { key: null, value: { orderId: 'ord_1', total: 4200 } },
  { messageFormat: MessageFormat.JSON },
);
```

## Avro

Supply a registry URL at module registration and install
`@kafkajs/confluent-schema-registry`, which is an **optional peer dependency** — only installed by
consumers who use Avro:

```sh
npm install @kafkajs/confluent-schema-registry
```

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

The handler receives the registry-decoded record as `message.value`. The record key decodes the
same leniently-JSON way as in JSON mode.

Declaring an Avro handler without `schemaRegistry` options throws at bootstrap with a message
naming both the option and the package to install. Producing Avro is not supported yet: a send
whose format resolves to `MessageFormat.AVRO`, including through the module default, rejects with
an error naming `MessageFormat.JSON` and `MessageFormat.ENVELOPED_JSON`.
