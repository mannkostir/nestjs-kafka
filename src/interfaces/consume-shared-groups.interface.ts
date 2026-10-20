import { SharedGroupRoute } from '../types/shared-group-route.type.js';

export interface IConsumeSharedGroups<TValue = unknown> {
  subscribeGroup(
    consumerGroupId: string,
    routes: SharedGroupRoute<TValue>[],
  ): Promise<void>;
}
