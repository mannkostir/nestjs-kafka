# Basic example

A Nest application context with a `@Message` handler and an injected `ProducerProxy`.
It needs no HTTP server or adapter. Use Node.js 24 (the package also supports
`^20.19.0 || >=22.12.0`), npm, and Docker with Compose v2 supporting `up --wait`.
NestJS 11 and 12 are supported; this example uses ESM and TypeScript's NodeNext resolution.

From the repository root, build the library before installing the example:

```sh
npm ci
npm run build
cd examples/basic
npm install --install-links --no-package-lock
npm run typecheck
npm run build
docker compose up -d --wait --wait-timeout 120
npm start
```

The example intentionally has no lockfile: use `npm install`, not `npm ci`, here.
`--install-links` packs the local `file:../..` dependency into the example's own
`node_modules` instead of linking the repository. Imports resolve the built package's
public exports and declarations, with no source aliases. After changing the library,
rebuild it, remove `node_modules/nestjs-kafka-connector` from this directory, and repeat
the install. To try NestJS 11, add `--no-save @nestjs/common@^11 @nestjs/core@^11`
to the example install command.

Compose waits until Kafka serves metadata. The broker advertises `localhost:9092`
to this app running on the host and `kafka:29092` inside Compose; port 9092 must be free.
Broker auto-topic creation is disabled. The library provisions `orders.created`
through the admin API because `createMissingTopics` is enabled.

Application bootstrap waits for the handler's consumer assignment before publishing
one order with a fresh ID and total `42`. Look for `Published order <id>` and
`Received order <id>: total=42, topic=orders.created, partition=0, offset=<offset>`
with the same ID; the log order can vary. The app stays subscribed until stopped.
Starting it again publishes another order. The fixed `basic-example` group resumes
committed offsets; on its first run it reads from the beginning. Delivery is at least
once, so duplicate logs are possible. Real handlers should make side effects idempotent.

Press Ctrl-C while the broker is still running. Nest's SIGINT/SIGTERM shutdown hooks
drain consumers and disconnect the producer. Then stop and remove the local broker:

```sh
docker compose down -v
```

If readiness fails, inspect `docker compose logs kafka` before starting the app.
This broker uses plaintext and single-node replication for local development only.
