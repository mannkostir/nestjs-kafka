import { ConsumerSubscriptionParameters } from '../types/consumer-subscription-parameters.type.js';
import { MessageHandlerCallback } from '../types/message-handler-callback.type.js';
import { MessageOptions } from '../types/message-options.type.js';
import { MessageType } from '../types/message.type.js';
import {
  assertValidMessageArguments,
  describeHandler,
} from './message-handler-arguments.js';

export const MessageHandlerKey = 'HANDLE_MESSAGE' as const;

export function Message(
  topicPattern: ConsumerSubscriptionParameters['topicPatterns'],
  options: MessageOptions,
): <THandler extends MessageHandlerCallback<MessageType<never>>>(
  target: object,
  propertyKey: string | symbol,
  descriptor: TypedPropertyDescriptor<THandler>,
) => void {
  return <THandler extends MessageHandlerCallback<MessageType<never>>>(
    target: object,
    propertyKey: string | symbol,
    descriptor: TypedPropertyDescriptor<THandler>,
  ): void => {
    assertValidMessageArguments(
      'Message',
      describeHandler('Message', target, propertyKey),
      topicPattern,
      options,
    );
    Reflect.defineMetadata(
      MessageHandlerKey,
      [topicPattern, options],
      descriptor.value as object,
    );
  };
}
