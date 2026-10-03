import { Module } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { KafkaJS } from '@confluentinc/kafka-javascript';
import { KafkaModule } from '../../src/kafka.module.js';
import { ProducerProxy } from '../../src/base/producer-proxy.js';
import { ProducerConfig } from '../../src/types/producer-config.type.js';
import { startBroker, StartedBroker } from './kafka-broker.js';

const UNKNOWN_TOPIC_PROPAGATION_MS = 30000;

describe('producer topic creation', () => {
  let broker: StartedBroker;

  const startApp = async (clientId: string, producer?: ProducerConfig): Promise<TestingModule> => {
    @Module({
      imports: [
        KafkaModule.register({
          clientOptions: { kafkaJS: { clientId, brokers: broker.brokers } },
          producer,
        }),
      ],
    })
    class ProducerOnlyModule {}

    const moduleRef = await Test.createTestingModule({ imports: [ProducerOnlyModule] }).compile();

    await moduleRef.init();

    return moduleRef;
  };

  beforeAll(async () => {
    broker = await startBroker();
  });

  afterAll(async () => {
    await broker?.stop();
  });

  describe('by default', () => {
    let moduleRef: TestingModule;
    let rejection: unknown;

    beforeAll(async () => {
      moduleRef = await startApp('producer-default');
      rejection = await moduleRef
        .get(ProducerProxy)
        .send('ledger.posted', { key: null, value: { entryId: 'e-1' } })
        .then(
          () => undefined,
          (error: unknown) => error,
        );
    }, UNKNOWN_TOPIC_PROPAGATION_MS * 2);

    afterAll(async () => {
      await moduleRef?.close();
    });

    it('rejects a send to a topic that does not exist', () => {
      expect(rejection).toMatchObject({
        name: 'KafkaJSProtocolError',
        code: KafkaJS.ErrorCodes.ERR_UNKNOWN_TOPIC_OR_PART,
        message: 'Broker: Unknown topic or partition',
      });
    });

    it('leaves the topic uncreated even though the broker would auto-create it', async () => {
      expect(await broker.listTopics()).not.toContain('ledger.posted');
    });
  });

  describe('with allowAutoTopicCreation', () => {
    let moduleRef: TestingModule;

    beforeAll(async () => {
      moduleRef = await startApp('producer-auto-create', { allowAutoTopicCreation: true });
    });

    afterAll(async () => {
      await moduleRef?.close();
    });

    it('lets the broker create the topic on first send', async () => {
      await moduleRef
        .get(ProducerProxy)
        .send('ledger.archived', { key: null, value: { entryId: 'e-2' } });

      expect(await broker.listTopics()).toContain('ledger.archived');
    });
  });
});
