import 'reflect-metadata';
import { ConsumerSubscriptionParameters } from '../types/consumer-subscription-parameters.type.js';
import { MessageOptions } from '../types/message-options.type.js';
import { Message, MessageHandlerKey } from './message-handler.decorator.js';

type TopicPatterns = ConsumerSubscriptionParameters['topicPatterns'];

const validOptions: MessageOptions = {
  groupId: 'orders-service',
  errorHandling: { type: 'fail' },
};

const asOptions = (value: unknown): MessageOptions => value as MessageOptions;
const asTopics = (value: unknown): TopicPatterns => value as TopicPatterns;

function defineOrdersHandler(topics: TopicPatterns, options: MessageOptions) {
  class OrdersHandler {
    @Message(topics, options)
    handle(): void {}
  }
  return OrdersHandler;
}

describe('@Message', () => {
  it('rejects undefined options, naming the handler', () => {
    expect(() =>
      defineOrdersHandler(['orders'], asOptions(undefined)),
    ).toThrow(/OrdersHandler\.handle.*options/);
  });

  it('rejects null options, naming the handler', () => {
    expect(() => defineOrdersHandler(['orders'], asOptions(null))).toThrow(
      /OrdersHandler\.handle.*options/,
    );
  });

  it('rejects options without a groupId', () => {
    expect(() =>
      defineOrdersHandler(
        ['orders'],
        asOptions({ errorHandling: { type: 'fail' } }),
      ),
    ).toThrow(/OrdersHandler\.handle.*"groupId"/);
  });

  it('rejects an empty groupId', () => {
    expect(() =>
      defineOrdersHandler(['orders'], { ...validOptions, groupId: '' }),
    ).toThrow(/OrdersHandler\.handle.*"groupId"/);
  });

  it('rejects a non-string groupId', () => {
    expect(() =>
      defineOrdersHandler(
        ['orders'],
        asOptions({ ...validOptions, groupId: 42 }),
      ),
    ).toThrow(/OrdersHandler\.handle.*"groupId"/);
  });

  it('rejects options without errorHandling', () => {
    expect(() =>
      defineOrdersHandler(['orders'], asOptions({ groupId: 'orders-service' })),
    ).toThrow(/OrdersHandler\.handle.*"errorHandling"/);
  });

  it('rejects errorHandling without a type', () => {
    expect(() =>
      defineOrdersHandler(
        ['orders'],
        asOptions({ ...validOptions, errorHandling: {} }),
      ),
    ).toThrow(/OrdersHandler\.handle.*"errorHandling\.type"/);
  });

  it('rejects an unknown errorHandling type', () => {
    expect(() =>
      defineOrdersHandler(
        ['orders'],
        asOptions({ ...validOptions, errorHandling: { type: 'retry' } }),
      ),
    ).toThrow(/OrdersHandler\.handle.*"errorHandling\.type"/);
  });

  it('rejects undefined topics', () => {
    expect(() =>
      defineOrdersHandler(asTopics(undefined), validOptions),
    ).toThrow(/OrdersHandler\.handle.*topic/);
  });

  it('rejects an empty topic list', () => {
    expect(() => defineOrdersHandler([], validOptions)).toThrow(
      /OrdersHandler\.handle.*topic/,
    );
  });

  it('rejects an empty topic string', () => {
    expect(() => defineOrdersHandler(asTopics(''), validOptions)).toThrow(
      /OrdersHandler\.handle.*topic/,
    );
  });

  it('rejects a topic list of empty strings', () => {
    expect(() => defineOrdersHandler(['', ''], validOptions)).toThrow(
      /OrdersHandler\.handle.*topic/,
    );
  });

  it('accepts a topic list with at least one non-empty topic', () => {
    expect(() => defineOrdersHandler(['', 'orders'], validOptions)).not.toThrow();
  });

  it('names the class of a static handler', () => {
    expect(() => {
      class PaymentsHandler {
        @Message(['payments'], asOptions(undefined))
        static handle(): void {}
      }
      return PaymentsHandler;
    }).toThrow(/PaymentsHandler\.handle/);
  });

  it('registers the topics and options on the handler method', () => {
    const topics = [/orders\..*/];

    const OrdersHandler = defineOrdersHandler(topics, validOptions);

    expect(
      Reflect.getMetadata(MessageHandlerKey, OrdersHandler.prototype.handle),
    ).toEqual([topics, validOptions]);
  });
});
