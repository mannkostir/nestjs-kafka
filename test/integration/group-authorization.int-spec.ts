import { Injectable, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { KafkaModule } from '../../src/kafka.module.js';
import { Message } from '../../src/decorators/message-handler.decorator.js';
import { MessageType } from '../../src/types/message.type.js';
import { startSaslBroker, StartedSaslBroker } from './sasl-kafka-broker.js';

const TOPIC = 'invoices.issued';

@Injectable()
class UnauthorizedGroupHandler {
  @Message([TOPIC], {
    groupId: 'invoices-unauthorized',
    errorHandling: { type: 'fail' },
  })
  async handle(_message: MessageType): Promise<void> {}
}

describe('group authorization', () => {
  let broker: StartedSaslBroker;

  beforeAll(async () => {
    broker = await startSaslBroker();
    await broker.createTopic(TOPIC);
    await broker.allowTopicRead('User:alice', TOPIC);
  });

  afterAll(async () => {
    await broker?.stop();
  });

  describe('a handler whose principal may read the topic but not the group', () => {
    let rejection: unknown;
    let elapsedMs: number;

    beforeAll(async () => {
      @Module({
        imports: [
          KafkaModule.register({
            clientOptions: {
              kafkaJS: {
                clientId: 'unauthorized-group',
                brokers: broker.brokers,
                sasl: { mechanism: 'plain', username: 'alice', password: 'alice' },
              },
            },
            consumerDefaults: { rebalanceTimeout: 20000, sessionTimeout: 10000 },
          }),
        ],
        providers: [UnauthorizedGroupHandler],
      })
      class UnauthorizedGroupModule {}

      const moduleRef = await Test.createTestingModule({
        imports: [UnauthorizedGroupModule],
      }).compile();

      const startedAt = Date.now();
      rejection = await moduleRef.init().then(
        () => moduleRef.close().then(() => undefined),
        (error: unknown) => error,
      );
      elapsedMs = Date.now() - startedAt;
    });

    it('fails bootstrap naming the group and the broker reason', () => {
      expect(rejection).toEqual(
        expect.objectContaining({
          message: expect.stringMatching(
            /Consumer group "invoices-unauthorized" cannot join: Broker: Group authorization failed/,
          ),
        }),
      );
    });

    it('fails bootstrap without waiting out the join timeout', () => {
      expect(elapsedMs).toBeLessThan(15000);
    });
  });
});
