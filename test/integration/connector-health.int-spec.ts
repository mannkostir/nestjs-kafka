import { Injectable } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ConnectorHealth, getHealthToken, KafkaModule, Message, ProducerProxy } from '../../src/index.js';
import { startBroker, StartedBroker } from './kafka-broker.js';
import { waitFor } from './wait.js';

let rejectNextDelivery = true;
let delivered = 0;

@Injectable()
class HealthHandler {
  @Message(['health-events'], {
    connectorName: 'health',
    groupId: 'health-workers',
    consumer: { fromBeginning: true, sessionTimeout: 6000, heartbeatInterval: 1000, rebalanceTimeout: 10000 },
    errorHandling: { type: 'fail', backoff: false },
  })
  async handle(): Promise<void> {
    if (rejectNextDelivery) {
      rejectNextDelivery = false;
      throw new Error('health worker delivery failed');
    }
    delivered++;
  }
}

describe('connector lifecycle health with a real broker', () => {
  let broker: StartedBroker;
  const contexts: TestingModule[] = [];

  beforeAll(async () => {
    broker = await startBroker();
    await broker.createTopics(['probe.health-events'], 2);
  });

  afterAll(async () => {
    for (const context of contexts.reverse()) {
      await context.close();
    }
    await broker?.stop();
  });

  const startConnector = async () => {
    const context = await Test.createTestingModule({
      imports: [KafkaModule.registerAsync({
        connectorName: 'health',
        useFactory: () => ({ namespace: 'probe', clientOptions: { kafkaJS: { brokers: broker.brokers } } }),
      })],
      providers: [HealthHandler],
    }).compile();
    contexts.push(context);
    await context.init();
    return context;
  };

  it('tracks assignment, worker failure and shutdown across broker rebalances', async () => {
    const first = await startConnector();
    const health = first.get<ConnectorHealth>(getHealthToken('health'));
    const group = () => health.snapshot().groups.find(({ groupId }) => groupId === 'probe-health-workers')!;
    await waitFor(() => group()?.joined && group().assignment.length === 2);
    expect(health.snapshot().producerConnected).toBe(true);
    expect(group().assignment.every(({ topic }) => topic === 'probe.health-events')).toBe(true);

    await first.get(ProducerProxy).send('health-events', { key: 'health', value: 1 });
    await waitFor(() => group().lastWorkerError !== null && delivered > 0);
    expect(group().lastWorkerError!.message).toContain('health worker delivery failed');

    const second = await startConnector();
    const secondHealth = second.get<ConnectorHealth>(getHealthToken('health'));
    await waitFor(() => group().assignment.length === 1 && secondHealth.snapshot().groups[0]?.assignment.length === 1);
    expect(new Set([...group().assignment, ...secondHealth.snapshot().groups[0].assignment].map(({ partition }) => partition)).size).toBe(2);

    await second.close();
    contexts.splice(contexts.indexOf(second), 1);
    expect(secondHealth.snapshot()).toMatchObject({ producerConnected: false, groups: [{ joined: false, assignment: [] }] });
    await waitFor(() => group().joined && group().assignment.length === 2);

    await first.close();
    contexts.splice(contexts.indexOf(first), 1);
    expect(health.snapshot()).toMatchObject({ producerConnected: false, groups: [{ joined: false, assignment: [] }] });
  });
});
