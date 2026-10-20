import { MessageBatchHandlerCallback } from '../types/message-batch-handler-callback.type.js';
import { MessageOptions } from '../types/message-options.type.js';
import {
  assertValidMessageArguments,
  describeHandler,
} from './message-handler-arguments.js';

export const MessageBatchHandlerKey = 'HANDLE_MESSAGE_BATCH' as const;

export function MessageBatch(
  topicPattern: (string | RegExp)[],
  options: MessageOptions,
): <TValue>(
  target: object,
  propertyKey: string | symbol,
  descriptor: TypedPropertyDescriptor<MessageBatchHandlerCallback<TValue>>,
) => void {
  return <TValue>(
    target: object,
    propertyKey: string | symbol,
    descriptor: TypedPropertyDescriptor<MessageBatchHandlerCallback<TValue>>,
  ): void => {
    assertValidMessageArguments(
      'MessageBatch',
      describeHandler('MessageBatch', target, propertyKey),
      topicPattern,
      options,
    );
    Reflect.defineMetadata(
      MessageBatchHandlerKey,
      [topicPattern, options],
      descriptor.value as object,
    );
  };
}
