import 'reflect-metadata';
import { MessageOptions } from '../types/message-options.type.js';
import { ReceivedMessage } from '../types/received-message.type.js';
import { MessageBatch, MessageBatchHandlerKey } from './message-batch-handler.decorator.js';
import { MessageHandlerKey } from './message-handler.decorator.js';

const validOptions: MessageOptions = {
  groupId: 'orders-indexer',
  errorHandling: { type: 'dlq' },
};

const asOptions = (value: unknown): MessageOptions => value as MessageOptions;

describe('@MessageBatch', () => {
  it('registers the topics and options under its own key', () => {
    class OrdersIndexer {
      @MessageBatch(['orders'], validOptions)
      async index(_batch: ReceivedMessage[]): Promise<void> {}
    }

    expect(
      Reflect.getMetadata(MessageBatchHandlerKey, OrdersIndexer.prototype.index),
    ).toEqual([['orders'], validOptions]);
  });

  it('does not register a per-message handler', () => {
    class OrdersIndexer {
      @MessageBatch(['orders'], validOptions)
      async index(_batch: ReceivedMessage[]): Promise<void> {}
    }

    expect(
      Reflect.getMetadata(MessageHandlerKey, OrdersIndexer.prototype.index),
    ).toBeUndefined();
  });

  it('rejects missing options, naming the batch handler', () => {
    expect(() => {
      class OrdersIndexer {
        @MessageBatch(['orders'], asOptions(undefined))
        async index(_batch: ReceivedMessage[]): Promise<void> {}
      }
      return OrdersIndexer;
    }).toThrow(/@MessageBatch handler OrdersIndexer\.index has no options/);
  });

  it('names @MessageBatch in the options hint', () => {
    expect(() => {
      class OrdersIndexer {
        @MessageBatch(['orders'], asOptions(undefined))
        async index(_batch: ReceivedMessage[]): Promise<void> {}
      }
      return OrdersIndexer;
    }).toThrow(/second argument of @MessageBatch/);
  });

  it('rejects an empty topic list, naming the batch handler', () => {
    expect(() => {
      class OrdersIndexer {
        @MessageBatch([], validOptions)
        async index(_batch: ReceivedMessage[]): Promise<void> {}
      }
      return OrdersIndexer;
    }).toThrow(/@MessageBatch handler OrdersIndexer\.index has no topic/);
  });

  it('rejects an unknown error handling type', () => {
    expect(() => {
      class OrdersIndexer {
        @MessageBatch(['orders'], asOptions({ ...validOptions, errorHandling: { type: 'skip' } }))
        async index(_batch: ReceivedMessage[]): Promise<void> {}
      }
      return OrdersIndexer;
    }).toThrow(/@MessageBatch handler OrdersIndexer\.index.*"errorHandling\.type"/);
  });

  it('rejects sharedGroup with a RegExp topic', () => {
    expect(() => {
      class OrdersIndexer {
        @MessageBatch(['orders', /refunds\..*/], { groupId: 'g', errorHandling: { type: 'fail' }, sharedGroup: true })
        async index(_batch: ReceivedMessage[]): Promise<void> {}
      }
      return OrdersIndexer;
    }).toThrow(/@MessageBatch handler .* sets sharedGroup but subscribes to a RegExp pattern/);
  });
});

describe('@MessageBatch handler signature', () => {
  it('only accepts a method taking the batch', () => {
    class OrdersIndexer {
      // @ts-expect-error
      @MessageBatch(['orders'], validOptions)
      async index(_message: string): Promise<void> {}
    }

    expect(OrdersIndexer).toBeDefined();
  });
});
