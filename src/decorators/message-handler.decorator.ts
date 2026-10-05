import { ConsumerSubscriptionParameters } from '../types/consumer-subscription-parameters.type.js';
import { MessageOptions } from '../types/message-options.type.js';
import {
  assertValidMessageArguments,
  describeHandler,
} from './message-handler-arguments.js';

export const MessageHandlerKey = 'HANDLE_MESSAGE' as const;

export function Message(
  topicPattern: ConsumerSubscriptionParameters['topicPatterns'],
  options: MessageOptions,
): MethodDecorator {
  return (
    target: object,
    propertyKey: string | symbol,
    descriptor: PropertyDescriptor,
  ) => {
    assertValidMessageArguments(
      'Message',
      describeHandler('Message', target, propertyKey),
      topicPattern,
      options,
    );
    Reflect.defineMetadata(
      MessageHandlerKey,
      [topicPattern, options],
      descriptor.value,
    );
  };
}
