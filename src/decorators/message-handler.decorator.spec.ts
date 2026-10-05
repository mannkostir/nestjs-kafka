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
  it('names the decorator in its error', () => {
    expect(() =>
      defineOrdersHandler(['orders'], asOptions(undefined)),
    ).toThrow(/@Message handler OrdersHandler\.handle has no options/);
  });

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
        asOptions({ ...validOptions, errorHandling: { type: 'skip' } }),
      ),
    ).toThrow(/OrdersHandler\.handle.*"errorHandling\.type"/);
  });

  it('accepts the retry errorHandling type', () => {
    expect(() =>
      defineOrdersHandler(
        ['orders'],
        asOptions({ ...validOptions, errorHandling: { type: 'retry', attempts: 3 } }),
      ),
    ).not.toThrow();
  });

  it('rejects undefined topics', () => {
    expect(() =>
      defineOrdersHandler(asTopics(undefined), validOptions),
    ).toThrow(/OrdersHandler\.handle.*array of topics/);
  });

  it('rejects null topics', () => {
    expect(() => defineOrdersHandler(asTopics(null), validOptions)).toThrow(
      /OrdersHandler\.handle.*array of topics/,
    );
  });

  it('rejects an empty topic list', () => {
    expect(() => defineOrdersHandler([], validOptions)).toThrow(
      /OrdersHandler\.handle.*topic/,
    );
  });

  it('rejects a single topic name that is not in an array', () => {
    expect(() => defineOrdersHandler(asTopics('orders'), validOptions)).toThrow(
      /OrdersHandler\.handle.*array of topics/,
    );
  });

  it('rejects an empty topic string', () => {
    expect(() => defineOrdersHandler([''], validOptions)).toThrow(
      /OrdersHandler\.handle has no topic/,
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

  it('accepts sharedGroup with concrete topic names', () => {
    expect(() =>
      defineOrdersHandler(['orders', 'refunds'], { ...validOptions, sharedGroup: true }),
    ).not.toThrow();
  });

  it('rejects sharedGroup with a RegExp topic, naming the handler', () => {
    expect(() =>
      defineOrdersHandler(['orders', /refunds\..*/], { ...validOptions, sharedGroup: true }),
    ).toThrow(
      '@Message handler OrdersHandler.handle sets sharedGroup but subscribes to a RegExp pattern. Handlers in a shared group must list concrete topic names.',
    );
  });

  it('accepts a RegExp topic when sharedGroup is false', () => {
    expect(() =>
      defineOrdersHandler([/refunds\..*/], { ...validOptions, sharedGroup: false }),
    ).not.toThrow();
  });

  it('rejects a non-boolean sharedGroup', () => {
    expect(() =>
      defineOrdersHandler(['orders'], asOptions({ ...validOptions, sharedGroup: 'yes' })),
    ).toThrow(
      '@Message handler OrdersHandler.handle has an invalid "sharedGroup" option: yes. Set sharedGroup to true or false, or leave it unset.',
    );
  });
});
