import { MessageHandlerCallback } from '../types/message-handler-callback.type.js';
import { MessageOptions } from '../types/message-options.type.js';
import {
  assertValidMessageArguments,
  describeHandler,
} from './message-handler-arguments.js';

export const MessageHandlerKey = 'HANDLE_MESSAGE' as const;

export function Message(
  topicPattern: (string | RegExp)[],
  options: MessageOptions,
): <THandler extends MessageHandlerCallback<never>>(
  target: object,
  propertyKey: string | symbol,
  descriptor: TypedPropertyDescriptor<THandler>,
) => void {
  return <THandler extends MessageHandlerCallback<never>>(
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
