import { Injectable, Module } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { KafkaModule } from '../../src/kafka.module.js';
import { Message } from '../../src/decorators/message-handler.decorator.js';
import { ProducerProxy } from '../../src/base/producer-proxy.js';
import { MessageType } from '../../src/types/message.type.js';
import { MessageContext } from '../../src/types/message-context.type.js';
import { startBroker, StartedBroker } from './kafka-broker.js';
import { waitFor } from './wait.js';

type ShipmentDispatched = { shipmentId: string };

const deliveries: { message: MessageType<ShipmentDispatched>; context: MessageContext }[] = [];

const deliveryOf = (key: string) => deliveries.find(({ message }) => message.key === key);

@Injectable()
class ShipmentHandler {
  @Message(['shipments.dispatched'], {
    groupId: 'handler-context',
    errorHandling: { type: 'fail' },
    consumer: { fromBeginning: true },
  })
  async handle(message: MessageType<ShipmentDispatched>, context: MessageContext): Promise<void> {
    deliveries.push({ message, context });
  }
}

describe('handler context', () => {
  let broker: StartedBroker;
  let moduleRef: TestingModule;

  beforeAll(async () => {
    broker = await startBroker();
    await broker.createTopics(['shipments.dispatched']);

    @Module({
      imports: [
        KafkaModule.register({
          clientOptions: { kafkaJS: { clientId: 'handler-context', brokers: broker.brokers } },
          consumerDefaults: { rebalanceTimeout: 20000, sessionTimeout: 10000 },
        }),
      ],
      providers: [ShipmentHandler],
    })
    class TestModule {}

    moduleRef = await Test.createTestingModule({ imports: [TestModule] }).compile();

    await moduleRef.init();

    const producer = moduleRef.get(ProducerProxy);

    await producer.send(
      'shipments.dispatched',
      {
        key: 'shipment-1',
        value: { shipmentId: 's-1' },
        headers: { 'x-correlation-id': 'c-1', 'x-tag': ['fragile', 'express'] },
      },
    );
    await producer.send(
      'shipments.dispatched',
      { key: 'shipment-2', value: { shipmentId: 's-2' } },
    );

    await waitFor(() => deliveries.length >= 2);
  });

  afterAll(async () => {
    await moduleRef?.close();
    await broker?.stop();
  });

  it('gives the handler a header sent through the producer', () => {
    expect(deliveryOf('shipment-1')?.message.headers?.['x-correlation-id']).toBe('c-1');
  });

  it('gives the handler every value of a repeated header in order', () => {
    expect(deliveryOf('shipment-1')?.message.headers?.['x-tag']).toEqual(['fragile', 'express']);
  });

  it('gives the handler empty headers for a record sent without any', () => {
    expect(deliveryOf('shipment-2')?.message.headers).toEqual({});
  });

  it('tells the handler where the record was read from', () => {
    expect(deliveryOf('shipment-1')?.context).toEqual({
      topic: 'shipments.dispatched',
      partition: expect.any(Number),
      offset: expect.stringMatching(/^\d+$/),
      timestamp: expect.stringMatching(/^\d+$/),
    });
  });
});
