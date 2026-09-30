import { Injectable, Module, Type } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { KafkaJS } from '@confluentinc/kafka-javascript';
import { KafkaModule } from '../../src/kafka.module.js';
import { Message } from '../../src/decorators/message-handler.decorator.js';
import { ProducerProxy } from '../../src/base/producer-proxy.js';
import { MessageType } from '../../src/types/message.type.js';
import { startBroker, StartedBroker } from './kafka-broker.js';
import { eventually, waitFor } from './wait.js';

type PaymentCaptured = { paymentId: string };

const captured: MessageType<PaymentCaptured>[] = [];
const refunded: MessageType<PaymentCaptured>[] = [];

@Injectable()
class PaymentCapturedHandler {
  @Message(['payments.captured'], {
    groupId: 'payments-resume',
    errorHandling: { type: 'fail' },
  })
  async handle(message: MessageType<PaymentCaptured>): Promise<void> {
    captured.push(message);
  }
}

@Injectable()
class PaymentRefundedHandler {
  @Message(['payments.refunded'], {
    groupId: 'payments-zero',
    errorHandling: { type: 'fail' },
  })
  async handle(message: MessageType<PaymentCaptured>): Promise<void> {
    refunded.push(message);
  }
}

const runningApps = new Set<TestingModule>();

const startApp = async (
  clientId: string,
  handler: Type,
  brokers: string[],
): Promise<TestingModule> => {
  @Module({
    imports: [KafkaModule.register({ clientOptions: { kafkaJS: { clientId, brokers } } })],
    providers: [handler],
  })
  class PaymentsModule {}

  const moduleRef = await Test.createTestingModule({ imports: [PaymentsModule] }).compile();

  runningApps.add(moduleRef);
  await moduleRef.init();

  return moduleRef;
};

const stopApp = async (moduleRef: TestingModule): Promise<void> => {
  runningApps.delete(moduleRef);
  await moduleRef.close();
};

const payloadsOf = (messages: MessageType<PaymentCaptured>[]) =>
  messages.map((message) => message.value?.payload);

describe('resuming from a committed offset', () => {
  let broker: StartedBroker;
  let kafka: KafkaJS.Kafka;
  let admin: KafkaJS.Admin;

  beforeAll(async () => {
    broker = await startBroker();
    kafka = new KafkaJS.Kafka({ kafkaJS: { clientId: 'offset-observer', brokers: broker.brokers } });
    admin = kafka.admin();
    await admin.connect();
  });

  afterAll(async () => {
    await Promise.allSettled([...runningApps].map(stopApp));
    await admin?.disconnect();
    await broker?.stop();
  });

  describe('a message produced while the group has no running member', () => {
    beforeAll(async () => {
      const first = await startApp('payments-first', PaymentCapturedHandler, broker.brokers);

      await first.get(ProducerProxy).send('payments.captured', {
        key: null,
        value: { payload: { paymentId: 'p-1' } },
      });
      await waitFor(() => captured.length === 1, 20000);
      await eventually(async () => {
        const [{ partitions }] = await admin.fetchOffsets({
          groupId: 'payments-resume',
          topics: ['payments.captured'],
        });

        expect(partitions).toEqual([expect.objectContaining({ partition: 0, offset: '1' })]);
      });
      await stopApp(first);

      const producer = kafka.producer();
      await producer.connect();
      await producer.send({
        topic: 'payments.captured',
        messages: [{ value: JSON.stringify({ payload: { paymentId: 'p-2' } }) }],
      });
      await producer.disconnect();

      await startApp('payments-second', PaymentCapturedHandler, broker.brokers);
    });

    it('is delivered once after restart without redelivering the committed one', async () => {
      await waitFor(() => captured.length === 2, 20000);

      expect(payloadsOf(captured)).toEqual([{ paymentId: 'p-1' }, { paymentId: 'p-2' }]);
    });
  });

  describe('a group whose committed offset is 0', () => {
    beforeAll(async () => {
      await admin.createTopics({ topics: [{ topic: 'payments.refunded' }] });

      const producer = kafka.producer();
      await producer.connect();
      await producer.send({
        topic: 'payments.refunded',
        messages: [{ value: JSON.stringify({ payload: { paymentId: 'r-1' } }) }],
      });
      await producer.disconnect();

      const committer = kafka.consumer({
        kafkaJS: { groupId: 'payments-zero', autoCommit: false },
      });
      await committer.connect();

      try {
        await committer.subscribe({ topics: ['payments.refunded'] });
        await committer.run({ eachMessage: async () => undefined });
        await waitFor(() => committer.assignment().length > 0, 30000);
        await committer.commitOffsets([{ topic: 'payments.refunded', partition: 0, offset: '0' }]);
      } finally {
        await committer.disconnect();
      }

      await startApp('payments-zero', PaymentRefundedHandler, broker.brokers);
    });

    it('starts from offset 0 instead of the log end', async () => {
      await waitFor(() => refunded.length === 1, 20000);

      expect(payloadsOf(refunded)).toEqual([{ paymentId: 'r-1' }]);
    });
  });
});
