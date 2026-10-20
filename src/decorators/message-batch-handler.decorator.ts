import { BatchMessageHandlerCallback } from '../types/batch-message-handler-callback.type.js';
import { MessageOptions } from '../types/message-options.type.js';
import { MessageType } from '../types/message.type.js';
import {
  assertValidMessageArguments,
  describeHandler,
} from './message-handler-arguments.js';

export const MessageBatchHandlerKey = 'HANDLE_MESSAGE_BATCH' as const;

export function MessageBatch(
  topicPattern: (string | RegExp)[],
  options: MessageOptions,
): <TMessage extends MessageType>(
  target: object,
  propertyKey: string | symbol,
  descriptor: TypedPropertyDescriptor<BatchMessageHandlerCallback<TMessage>>,
) => void {
  return <TMessage extends MessageType>(
    target: object,
    propertyKey: string | symbol,
    descriptor: TypedPropertyDescriptor<BatchMessageHandlerCallback<TMessage>>,
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
