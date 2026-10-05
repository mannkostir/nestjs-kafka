import { MessageType } from '../types/message.type.js';
import { SharedGroupRoute } from '../types/shared-group-route.type.js';

export interface IConsumeSharedGroups<TMessage extends MessageType = MessageType> {
  subscribeGroup(
    consumerGroupId: string,
    routes: SharedGroupRoute<TMessage>[],
  ): Promise<void>;
}
