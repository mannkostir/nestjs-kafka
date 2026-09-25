import { Injectable, Module } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { KafkaModule } from '../../src/kafka.module.js';
import { Message } from '../../src/decorators/message-handler.decorator.js';
import { ProducerProxy } from '../../src/base/producer-proxy.js';
import { MessageType } from '../../src/types/message.type.js';
import { startBroker, StartedBroker } from './kafka-broker.js';

type OrderCreated = { orderId: string };

const received: MessageType<OrderCreated>[] = [];

@Injectable()
class OrderHandler {
  @Message(['orders.created'], {
    groupId: 'round-trip',
    errorHandling: { type: 'fail' },
    consumer: { fromBeginning: true },
  })
  async handle(message: MessageType<OrderCreated>): Promise<void> {
    received.push(message);
  }
}

const waitFor = async (
  predicate: () => boolean,
  timeoutMs = 60000,
): Promise<void> => {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (predicate()) {
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  throw new Error('Timed out waiting for the expected condition');
};

describe('produce and consume round trip', () => {
  let broker: StartedBroker;
  let moduleRef: TestingModule;

  beforeAll(async () => {
    broker = await startBroker();

    @Module({
      imports: [
        KafkaModule.register({
          clientOptions: { clientId: 'round-trip', brokers: broker.brokers },
        }),
      ],
      providers: [OrderHandler],
    })
    class TestModule {}

    moduleRef = await Test.createTestingModule({ imports: [TestModule] }).compile();

    await moduleRef.init();
  });

  afterAll(async () => {
    await moduleRef?.close();
    await broker?.stop();
  });

  it('delivers a produced message to the decorated handler', async () => {
    const producer = moduleRef.get(ProducerProxy);

    await producer.send(
      'orders.created',
      { key: null, value: { payload: { orderId: 'o-1' } } },
      { key: 'order-1' },
    );

    await waitFor(() => received.length > 0);

    expect(received[0].value?.payload).toEqual({ orderId: 'o-1' });
    expect(received[0].key).toBe('order-1');
  });
});
