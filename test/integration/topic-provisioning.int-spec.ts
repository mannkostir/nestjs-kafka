import { Injectable, Module } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { KafkaModule } from '../../src/kafka.module.js';
import { Message } from '../../src/decorators/message-handler.decorator.js';
import { ProducerProxy } from '../../src/base/producer-proxy.js';
import { MessageType } from '../../src/types/message.type.js';
import { startBroker, StartedBroker } from './kafka-broker.js';
import { waitFor } from './wait.js';

const shipped: MessageType[] = [];

@Injectable()
class LateTopicHandler {
  @Message(['shipments.created'], {
    groupId: 'late-topic',
    errorHandling: { type: 'fail' },
  })
  async handle(message: MessageType): Promise<void> {
    shipped.push(message);
  }
}

@Injectable()
class StrictTopicHandler {
  @Message(['refunds.created'], {
    groupId: 'strict-topic',
    errorHandling: { type: 'fail' },
    consumer: { allowAutoTopicCreation: false },
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
        value: { payload: { shipmentId: 's-1' } },
      });

      await waitFor(() => shipped.length > 0, 20000);

      expect(shipped[0].value?.payload).toEqual({ shipmentId: 's-1' });
    });
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
        /Topic\(s\) refunds\.created do not exist and allowAutoTopicCreation is false/,
      );

      await expect(
        moduleRef.get(ProducerProxy).send('refunds.created', { key: null, value: { payload: {} } }),
      ).rejects.toThrow(/connect/);
    });
  });
});
