import { ConsumerSubscriptionParameters } from '../types/consumer-subscription-parameters.type';
import { MessageOptions } from '../types/message-options.type';

export const MessageHandlerKey = 'HANDLE_MESSAGE' as const;

export function Message(
  topicPattern: ConsumerSubscriptionParameters['topicPatterns'],
  options: MessageOptions,
): MethodDecorator {
  return (_target, _propertyKey?: string | symbol, descriptor?: any) => {
    Reflect.defineMetadata(
      MessageHandlerKey,
      [topicPattern, options],
      descriptor.value,
    );
  };
}
