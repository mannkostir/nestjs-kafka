# Connector health

Inject `ConnectorHealth` from `nestjs-kafka-connector` for one unnamed connector and call `snapshot()`. It returns a frozen `ConnectorHealthSnapshot` containing `producerConnected` and a `groups` array. Snapshots and their nested values are immutable and detached from later observations. The library has no Terminus dependency and does not decide your readiness policy.

For named connectors, inject `@Inject(getHealthToken('analytics')) health: ConnectorHealth`. Each registration owns its state. With `registerAsync`, set `connectorName: 'analytics'` on the registration options, alongside `useFactory`, `useClass` or `useExisting`. A factory-only name supports plain class injection but cannot create a named injection alias. A returned name must match the static name if both are supplied.

## Snapshot semantics

- `producerConnected` becomes true when the client's `connect()` resolves. It becomes false when another connection attempt starts or shutdown begins, including failed disconnects. It records local lifecycle state; it does not continuously observe broker connectivity.
- Each group entry contains its effective, namespaced `groupId`, `joined`, `assignment` and `lastWorkerError`. Shared handler groups have one entry. Groups appear when subscription starts, including starts still provisioning or connecting. Failed starts remain unjoined with an empty assignment.
- `joined` means an assignment callback has completed since the latest revocation. A joined member can have an empty assignment when other members own all partitions. Revocation clears `joined` and the reported assignment until a new assignment callback completes. During a cooperative rebalance this deliberately reports unjoined even if the client temporarily retains some partitions.
- While joined, `snapshot()` reads the client's public `assignment()` locally. Partitions contain only `topic` and `partition`; there are no SDK objects. A snapshot taken during a rebalance can reflect the interval between the callback and the client applying its assignment. Recheck after the rebalance settles. If the local assignment read fails, the error is retained in `lastWorkerError` and the group reports unjoined until a later assignment callback. Pattern-only subscriptions can bootstrap without joining when no topic matches.
- `lastWorkerError` is null initially, otherwise an immutable `{ message }` describing the latest delivery error escaping the configured error policy or error-level consumer client log. This includes client worker failures after bootstrap. Client logs still delegate to the configured logger and respect the client's log level. Handled failures that do not escape the policy or produce a client error log are not recorded. The diagnostic remains after recovery, rebalance and shutdown; a replacement subscription starts fresh. It does not itself mean the worker has stopped.
- Consumer shutdown immediately reports all groups unjoined with empty assignments, including pending starts and timed-out drains. Late callbacks from a stopped or replaced subscription cannot restore its health. False connection/join flags on shutdown do not prove that a failed or timed-out disconnect released every native resource.

No snapshot performs an active broker ping. Successful bootstrap does not prove current broker reachability, message progress or successful delivery. Hosts needing those guarantees must check them separately. Before handler discovery, the group list is empty; a producer-only connector also has no groups.

## Host HealthIndicator

A host using Terminus can wrap the API with its own indicator. This example requires a producer connection and every registered group to be joined with at least one partition. That policy may be too strict for idle pattern subscriptions or groups with more members than partitions. It treats the retained error as a diagnostic; choose a separate policy if a past worker failure should affect readiness.

```typescript
import { Injectable } from '@nestjs/common';
import { HealthIndicatorService } from '@nestjs/terminus';
import { ConnectorHealth } from 'nestjs-kafka-connector';

@Injectable()
export class KafkaHealthIndicator {
  constructor(
    private readonly health: ConnectorHealth,
    private readonly indicators: HealthIndicatorService,
  ) {}

  isHealthy(key = 'kafka') {
    const snapshot = this.health.snapshot();
    const ready = snapshot.producerConnected && snapshot.groups.every(
      (group) => group.joined && group.assignment.length > 0,
    );
    const indicator = this.indicators.check(key);
    return ready ? indicator.up() : indicator.down();
  }
}
```

Provide this class alongside the host's `TerminusModule` and connector import, then use it in the host's existing health check. Named connectors use `@Inject(getHealthToken(name))` instead of plain class injection. See Nest's [custom health indicators](https://docs.nestjs.com/recipes/terminus#custom-health-indicator) for the host-side API.

## Broker verification

The focused broker spec exercises named async injection, actual assignment callbacks, worker error observation, partition redistribution between two members, reassignment after departure and shutdown snapshots:

```bash
npm run test:integration -- --runTestsByPath test/integration/connector-health.int-spec.ts
```

It needs Docker and the repository's supported test Node version. Unit stubs alone cannot establish the client's real callback timing or broker behavior. Consumer/producer changes also require the complete serial `npm run test:integration` gate.
