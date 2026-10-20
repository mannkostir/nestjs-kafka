import { Injectable } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { MessageType } from '../types/message.type.js';
import { ProducedRecord } from '../types/produced-record.type.js';
import { ProducerProxy } from './producer-proxy.js';

class RecordingProducer extends ProducerProxy {
  public readonly sent: MessageType[] = [];

  public async send<TValue>(topic: string, message: MessageType<TValue>): Promise<ProducedRecord[]> {
    this.sent.push(message);

    return [{ topic, partition: 0, offset: String(this.sent.length - 1) }];
  }
}

@Injectable()
class CheckoutService {
  constructor(private readonly producer: ProducerProxy) {}

  async checkout(): Promise<ProducedRecord[]> {
    await this.producer.send<{ orderId: string }>('orders.created', { key: null, value: { orderId: 'o-1' } });

    return this.producer.send<{ amount: number }>('payments.requested', { key: null, value: { amount: 4200 } });
  }
}

describe('ProducerProxy', () => {
  it('lets one injected producer send a different value type per call', async () => {
    const producer = new RecordingProducer();
    const moduleRef = await Test.createTestingModule({
      providers: [CheckoutService, { provide: ProducerProxy, useValue: producer }],
    }).compile();

    const produced = await moduleRef.get(CheckoutService).checkout();

    expect(produced).toEqual([{ topic: 'payments.requested', partition: 0, offset: '1' }]);
  });
});
