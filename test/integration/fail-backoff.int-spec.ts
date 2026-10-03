import { Injectable, Logger, Module } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { KafkaJS } from '@confluentinc/kafka-javascript';
import { KafkaModule } from '../../src/kafka.module.js';
import { Message } from '../../src/decorators/message-handler.decorator.js';
import { ProducerProxy } from '../../src/base/producer-proxy.js';
import { MessageType } from '../../src/types/message.type.js';
import { startBroker, StartedBroker } from './kafka-broker.js';
import { eventually, pause, waitFor } from './wait.js';

type ShipmentCreated = { shipmentId: string };

const alwaysFailingDeliveries: number[] = [];
const recoveringDeliveries: MessageType<ShipmentCreated>[] = [];
const shutdownDeliveries: number[] = [];

@Injectable()
class AlwaysFailingShipmentHandler {
  @Message(['shipments.growing-backoff'], {
    groupId: 'backoff-growth',
    errorHandling: { type: 'fail', backoff: { initialMs: 200, multiplier: 2, maxMs: 2000 } },
    consumer: { fromBeginning: true },
  })
  async handle(): Promise<void> {
    alwaysFailingDeliveries.push(Date.now());
    throw new Error('permanent failure');
  }
}

@Injectable()
class RecoveringShipmentHandler {
  @Message(['shipments.recovering'], {
    groupId: 'backoff-recovery',
    errorHandling: { type: 'fail', backoff: { initialMs: 100 } },
    consumer: { fromBeginning: true },
  })
  async handle(message: MessageType<ShipmentCreated>): Promise<void> {
    recoveringDeliveries.push(message);

    if (recoveringDeliveries.length <= 3) {
      throw new Error('transient failure');
    }
  }
}

@Injectable()
class ShutdownShipmentHandler {
  @Message(['shipments.shutdown'], {
    groupId: 'backoff-shutdown',
    errorHandling: { type: 'fail', backoff: { initialMs: 3000, maxMs: 3000 } },
    consumer: { fromBeginning: true },
  })
  async handle(): Promise<void> {
    shutdownDeliveries.push(Date.now());
    throw new Error('permanent failure');
  }
}

const gapsBetween = (timestamps: number[]): number[] =>
  timestamps.slice(1).map((timestamp, index) => timestamp - timestamps[index]);

const clientOptions = (clientId: string, brokers: string[]) => ({
  kafkaJS: { clientId, brokers },
});

describe('fail policy backoff', () => {
  let broker: StartedBroker;

  beforeAll(async () => {
    broker = await startBroker();
    await broker.createTopics([
      'shipments.growing-backoff',
      'shipments.recovering',
      'shipments.shutdown',
    ]);
  });

  afterAll(async () => {
    await broker?.stop();
  });

  describe('while the application runs', () => {
    let moduleRef: TestingModule;
    let admin: KafkaJS.Admin;

    beforeAll(async () => {
      admin = new KafkaJS.Kafka(clientOptions('backoff-observer', broker.brokers)).admin();
      await admin.connect();

      @Module({
        imports: [KafkaModule.register({ clientOptions: clientOptions('fail-backoff', broker.brokers) })],
        providers: [AlwaysFailingShipmentHandler, RecoveringShipmentHandler],
      })
      class TestModule {}

      moduleRef = await Test.createTestingModule({ imports: [TestModule] }).compile();

      await moduleRef.init();
    });

    afterAll(async () => {
      await admin?.disconnect();
      await moduleRef?.close();
    });

    it('redelivers a failing message after delays that grow', async () => {
      await moduleRef.get(ProducerProxy).send('shipments.growing-backoff', {
        key: null,
        value: { shipmentId: 's-1' },
      });

      await waitFor(() => alwaysFailingDeliveries.length >= 5);
      const [first, , , fourth] = gapsBetween(alwaysFailingDeliveries);

      expect(first).toBeGreaterThanOrEqual(150);
      expect(fourth).toBeGreaterThan(first * 2);
    });

    it('processes a message that succeeds after failing', async () => {
      await moduleRef.get(ProducerProxy).send('shipments.recovering', {
        key: null,
        value: { shipmentId: 's-2' },
      });

      await waitFor(() => recoveringDeliveries.length >= 4);

      expect(recoveringDeliveries[3].value).toEqual({ shipmentId: 's-2' });
    });

    it('commits past the message once a delivery succeeds', async () => {
      await eventually(async () => {
        const [{ partitions }] = await admin.fetchOffsets({
          groupId: 'backoff-recovery',
          topics: ['shipments.recovering'],
        });

        expect(partitions.map(({ offset }) => offset)).toEqual(['1']);
      });
    });
  });

  describe('when the application closes mid-backoff', () => {
    const unhandledErrors: unknown[] = [];
    const recordUnhandled = (error: unknown) => {
      unhandledErrors.push(error);
    };
    let warn: jest.SpyInstance;
    let moduleRef: TestingModule;

    beforeAll(async () => {
      warn = jest.spyOn(Logger.prototype, 'warn');
      process.on('unhandledRejection', recordUnhandled);
      process.on('uncaughtException', recordUnhandled);

      @Module({
        imports: [KafkaModule.register({ clientOptions: clientOptions('backoff-shutdown', broker.brokers) })],
        providers: [ShutdownShipmentHandler],
      })
      class TestModule {}

      moduleRef = await Test.createTestingModule({ imports: [TestModule] }).compile();

      await moduleRef.init();
      await moduleRef.get(ProducerProxy).send('shipments.shutdown', {
        key: null,
        value: { shipmentId: 's-3' },
      });
      await waitFor(() => shutdownDeliveries.length >= 1);
    });

    afterAll(() => {
      process.off('unhandledRejection', recordUnhandled);
      process.off('uncaughtException', recordUnhandled);
      warn.mockRestore();
    });

    it('closes without throwing', async () => {
      await expect(moduleRef.close()).resolves.toBeUndefined();
    });

    it('raises no error once the scheduled redelivery would have fired', async () => {
      await pause(4000);

      expect(unhandledErrors).toEqual([]);
    });

    it('never tries to resume the paused partition after closing', () => {
      expect(warn).not.toHaveBeenCalledWith(expect.stringContaining('Could not resume'));
    });

    it('does not redeliver after closing', () => {
      expect(shutdownDeliveries).toHaveLength(1);
    });
  });
});
