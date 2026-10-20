import { Injectable, Module } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { KafkaJS } from '@confluentinc/kafka-javascript';
import { KafkaModule } from '../../src/kafka.module.js';
import { Message } from '../../src/decorators/message-handler.decorator.js';
import { ProducerProxy } from '../../src/base/producer-proxy.js';
import { MessageType } from '../../src/types/message.type.js';
import { startBroker, StartedBroker } from './kafka-broker.js';
import { eventually, waitFor } from './wait.js';

const shipped: MessageType[] = [];

@Injectable()
class LateTopicHandler {
  @Message(['shipments.created'], {
    groupId: 'late-topic',
    errorHandling: { type: 'fail' },
    consumer: { createMissingTopics: true },
  })
  async handle(message: MessageType): Promise<void> {
    shipped.push(message);
  }
}

@Injectable()
class PatternOnlyHandler {
  @Message([/^inventory\..+/], {
    groupId: 'pattern-only',
    errorHandling: { type: 'fail' },
  })
  async handle(_message: MessageType): Promise<void> {}
}

@Injectable()
class StrictTopicHandler {
  @Message(['refunds.created'], {
    groupId: 'strict-topic',
    errorHandling: { type: 'fail' },
    consumer: { createMissingTopics: false },
  })
  async handle(_message: MessageType): Promise<void> {}
}

@Injectable()
class StrictCreditsHandler {
  @Message(['credits.created'], {
    groupId: 'strict-credits',
    errorHandling: { type: 'fail' },
    consumer: { createMissingTopics: false },
  })
  async handle(_message: MessageType): Promise<void> {}
}

@Injectable()
class StrictRebatesHandler {
  @Message(['rebates.created'], {
    groupId: 'strict-rebates',
    errorHandling: { type: 'fail' },
    consumer: { createMissingTopics: false },
  })
  async handle(_message: MessageType): Promise<void> {}
}

@Injectable()
class HealthyNeighbourHandler {
  @Message(['payouts.created'], {
    groupId: 'healthy-neighbour',
    errorHandling: { type: 'fail' },
  })
  async handle(_message: MessageType): Promise<void> {}
}

@Injectable()
class DefaultTopicHandler {
  @Message(['returns.created'], {
    groupId: 'default-topic',
    errorHandling: { type: 'fail' },
  })
  async handle(_message: MessageType): Promise<void> {}
}

@Injectable()
class MissingDeadLetterHandler {
  @Message(['chargebacks.created'], {
    groupId: 'missing-dead-letter',
    errorHandling: { type: 'dlq' },
  })
  async handle(_message: MessageType): Promise<void> {}
}

@Injectable()
class CreatedDeadLetterHandler {
  @Message(['disputes.created'], {
    groupId: 'created-dead-letter',
    errorHandling: { type: 'dlq' },
    consumer: { createMissingTopics: true },
  })
  async handle(_message: MessageType): Promise<void> {}
}

describe('topic provisioning', () => {
  let broker: StartedBroker;

  beforeAll(async () => {
    broker = await startBroker();
  });

  afterAll(async () => {
    await broker?.stop();
  });

  describe('a handler whose topic does not exist at bootstrap', () => {
    let moduleRef: TestingModule;

    beforeAll(async () => {
      @Module({
        imports: [
          KafkaModule.register({
            clientOptions: { kafkaJS: { clientId: 'late-topic', brokers: broker.brokers } },
          }),
        ],
        providers: [LateTopicHandler],
      })
      class LateTopicModule {}

      moduleRef = await Test.createTestingModule({ imports: [LateTopicModule] }).compile();

      await moduleRef.init();
    });

    afterAll(async () => {
      await moduleRef?.close();
    });

    it('receives a message produced right after bootstrap without fromBeginning', async () => {
      await moduleRef.get(ProducerProxy).send('shipments.created', {
        key: null,
        value: { shipmentId: 's-1' },
      });

      await waitFor(() => shipped.length > 0, 20000);

      expect(shipped[0].value).toEqual({ shipmentId: 's-1' });
    });
  });

  describe('a pattern handler whose pattern matches no topic yet', () => {
    it('bootstraps without waiting for a matching topic', async () => {
      @Module({
        imports: [
          KafkaModule.register({
            clientOptions: { kafkaJS: { clientId: 'pattern-only', brokers: broker.brokers } },
          }),
        ],
        providers: [PatternOnlyHandler],
      })
      class PatternOnlyModule {}

      const moduleRef = await Test.createTestingModule({
        imports: [PatternOnlyModule],
      }).compile();

      await moduleRef.init();
      await moduleRef.close();
    }, 30000);
  });

  describe('a handler that forbids topic creation', () => {
    it('fails bootstrap and names the missing topic', async () => {
      @Module({
        imports: [
          KafkaModule.register({
            clientOptions: { kafkaJS: { clientId: 'strict-topic', brokers: broker.brokers } },
          }),
        ],
        providers: [StrictTopicHandler],
      })
      class StrictTopicModule {}

      const moduleRef = await Test.createTestingModule({
        imports: [StrictTopicModule],
      }).compile();

      await expect(moduleRef.init()).rejects.toThrow(
        /Topic\(s\) refunds\.created do not exist and createMissingTopics is false/,
      );

      await expect(
        moduleRef.get(ProducerProxy).send('refunds.created', { key: null, value: {} }),
      ).rejects.toThrow(/connect/);
    });
  });

  describe('two handlers that forbid topic creation on distinct missing topics', () => {
    it('fails bootstrap with one error naming both handlers and both topics', async () => {
      @Module({
        imports: [
          KafkaModule.register({
            clientOptions: { kafkaJS: { clientId: 'strict-pair', brokers: broker.brokers } },
          }),
        ],
        providers: [StrictCreditsHandler, StrictRebatesHandler],
      })
      class StrictPairModule {}

      const moduleRef = await Test.createTestingModule({
        imports: [StrictPairModule],
      }).compile();

      await expect(moduleRef.init()).rejects.toThrow(
        /StrictCreditsHandler\.handle \(groupId "strict-credits"\): Topic\(s\) credits\.created do not exist[\s\S]*StrictRebatesHandler\.handle \(groupId "strict-rebates"\): Topic\(s\) rebates\.created do not exist/,
      );
    });
  });

  describe('a handler on a missing topic without opting in to creation', () => {
    it('fails bootstrap and leaves the topic uncreated', async () => {
      @Module({
        imports: [
          KafkaModule.register({
            clientOptions: { kafkaJS: { clientId: 'default-topic', brokers: broker.brokers } },
          }),
        ],
        providers: [DefaultTopicHandler],
      })
      class DefaultTopicModule {}

      const moduleRef = await Test.createTestingModule({
        imports: [DefaultTopicModule],
      }).compile();

      await expect(moduleRef.init()).rejects.toThrow(
        /Topic\(s\) returns\.created do not exist and createMissingTopics is false/,
      );
      expect(await broker.listTopics()).not.toContain('returns.created');
    });
  });

  describe('a dead letter handler whose dead letter topic does not exist', () => {
    it('fails bootstrap naming the dead letter topic', async () => {
      await broker.createTopics(['chargebacks.created']);

      @Module({
        imports: [
          KafkaModule.register({
            clientOptions: { kafkaJS: { clientId: 'missing-dead-letter', brokers: broker.brokers } },
          }),
        ],
        providers: [MissingDeadLetterHandler],
      })
      class MissingDeadLetterModule {}

      const moduleRef = await Test.createTestingModule({
        imports: [MissingDeadLetterModule],
      }).compile();

      await expect(moduleRef.init()).rejects.toThrow(
        /Topic\(s\) chargebacks\.created\.dlq do not exist and createMissingTopics is false/,
      );
      expect(await broker.listTopics()).not.toContain('chargebacks.created.dlq');
    });
  });

  describe('a dead letter handler that opts in to topic creation', () => {
    it('creates the dead letter topic at bootstrap', async () => {
      @Module({
        imports: [
          KafkaModule.register({
            clientOptions: { kafkaJS: { clientId: 'created-dead-letter', brokers: broker.brokers } },
          }),
        ],
        providers: [CreatedDeadLetterHandler],
      })
      class CreatedDeadLetterModule {}

      const moduleRef = await Test.createTestingModule({
        imports: [CreatedDeadLetterModule],
      }).compile();

      await moduleRef.init();

      try {
        expect(await broker.listTopics()).toContain('disputes.created.dlq');
      } finally {
        await moduleRef.close();
      }
    }, 60000);
  });

  describe('a healthy handler next to one that forbids topic creation', () => {
    it('leaves the healthy handler without group membership once bootstrap fails', async () => {
      await broker.createTopics(['payouts.created']);

      @Module({
        imports: [
          KafkaModule.register({
            clientOptions: { kafkaJS: { clientId: 'healthy-neighbour', brokers: broker.brokers } },
            consumerDefaults: { rebalanceTimeout: 20000, sessionTimeout: 10000 },
          }),
        ],
        providers: [HealthyNeighbourHandler, StrictTopicHandler],
      })
      class MixedModule {}

      const moduleRef = await Test.createTestingModule({ imports: [MixedModule] }).compile();

      const bootstrap = moduleRef.init();

      await expect(bootstrap).rejects.toThrow(/^- StrictTopicHandler\.handle \(groupId "strict-topic"\): .*refunds\.created/m);
      await expect(bootstrap).rejects.not.toThrow(/^- HealthyNeighbourHandler/m);

      const admin = new KafkaJS.Kafka({
        kafkaJS: { clientId: 'release-observer', brokers: broker.brokers },
      }).admin();
      await admin.connect();

      try {
        await eventually(async () => {
          const { groups } = await admin.describeGroups(['healthy-neighbour']);

          expect(groups).toEqual([
            expect.objectContaining({ groupId: 'healthy-neighbour', members: [] }),
          ]);
          expect([KafkaJS.ConsumerGroupStates.EMPTY, KafkaJS.ConsumerGroupStates.DEAD]).toContain(groups[0].state);
        });
      } finally {
        await admin.disconnect();
      }
    }, 90000);
  });
});
