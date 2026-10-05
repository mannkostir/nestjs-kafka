import {
  Inject,
  Injectable,
  Logger,
  OnApplicationBootstrap,
  Optional,
  Scope,
} from '@nestjs/common';
import { DiscoveryService, MetadataScanner } from '@nestjs/core';

import { ConsumerProxy } from '../base/consumer-proxy.js';
import { MessageBatchHandlerKey } from '../decorators/message-batch-handler.decorator.js';
import {
  Message,
  MessageHandlerKey,
} from '../decorators/message-handler.decorator.js';
import { BatchMessageHandlerCallback } from '../types/batch-message-handler-callback.type.js';
import { ConsumerSubscriptionParameters } from '../types/consumer-subscription-parameters.type.js';
import { MessageHandlerCallback } from '../types/message-handler-callback.type.js';
import { MessageType } from '../types/message.type.js';
import { SharedGroupRoute, RouteDelivery } from '../types/shared-group-route.type.js';
import { IConsumeMessageBatches } from '../interfaces/consume-message-batches.interface.js';
import { IConsumeSharedGroups } from '../interfaces/consume-shared-groups.interface.js';
import { IReleaseConnections } from '../interfaces/release-connections.interface.js';
import {
  BATCH_CONSUMER,
  CONNECTOR_NAME,
  KAFKA_CONNECTIONS,
  SHARED_GROUP_CONSUMER,
} from '../tokens.js';

type HandlerMetadata = Parameters<typeof Message>;

type HandlerMethod = (...args: never[]) => Promise<void>;

type HandlerKind = {
  metadataKey: string;
  subscribe: (
    subscription: ConsumerSubscriptionParameters,
    handle: HandlerMethod,
    groupId: string,
  ) => Promise<void>;
  delivery: (handle: HandlerMethod) => RouteDelivery;
};

type ProviderWrapper = ReturnType<DiscoveryService['getProviders']>[number];

type AnnotatedMethod = {
  methodName: string;
  method: HandlerMethod;
  metadata: HandlerMetadata;
  kind: HandlerKind;
};

type DiscoveredHandler = {
  handlerClass: Function;
  name: string;
  metadata: HandlerMetadata;
  kind: HandlerKind;
  handle: HandlerMethod;
};

const isObject = (value: unknown): value is object =>
  typeof value === 'object' && value !== null;

@Injectable()
export class MessageHandlersDiscoveryService implements OnApplicationBootstrap {
  private readonly logger = new Logger(MessageHandlersDiscoveryService.name);

  private readonly kinds: readonly HandlerKind[] = [
    {
      metadataKey: MessageHandlerKey,
      subscribe: (subscription, handle, groupId) =>
        this.consumerProxy.subscribe(
          subscription,
          handle as MessageHandlerCallback<MessageType>,
          groupId,
        ),
      delivery: (handle) => ({
        kind: 'message',
        handle: handle as MessageHandlerCallback<MessageType>,
      }),
    },
    {
      metadataKey: MessageBatchHandlerKey,
      subscribe: (subscription, handle, groupId) =>
        this.batchConsumer.subscribeBatch(
          subscription,
          handle as BatchMessageHandlerCallback<MessageType>,
          groupId,
        ),
      delivery: (handle) => ({
        kind: 'batch',
        handle: handle as BatchMessageHandlerCallback<MessageType>,
      }),
    },
  ];

  constructor(
    private readonly consumerProxy: ConsumerProxy,
    @Inject(BATCH_CONSUMER)
    private readonly batchConsumer: IConsumeMessageBatches,
    @Inject(SHARED_GROUP_CONSUMER)
    private readonly sharedGroupConsumer: IConsumeSharedGroups,
    private readonly discoveryService: DiscoveryService,
    private readonly metadataScanner: MetadataScanner,
    @Inject(KAFKA_CONNECTIONS)
    private readonly connections: IReleaseConnections,
    @Optional()
    @Inject(CONNECTOR_NAME)
    private readonly connectorName?: string,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    try {
      await this.mapEventsToHandlers();
    } catch (error) {
      try {
        await this.connections.releaseConnections();
      } catch (releaseError) {
        this.logger.error(
          'Failed to release Kafka connections after a failed bootstrap',
          releaseError,
        );
      }
      throw error;
    }
  }

  private async mapEventsToHandlers(): Promise<void> {
    this.assertNoScopedHandlers();

    const handlers = this.discoverHandlers().filter((handler) =>
      this.belongsToThisConnector(handler.metadata),
    );

    const groups = this.groupsOf(handlers);

    groups.forEach((group) => this.assertMayShareGroup(group));

    const results = await Promise.allSettled(
      groups.map((group) => this.subscribeGroup(group)),
    );
    const failure = results.find(
      (result): result is PromiseRejectedResult => result.status === 'rejected',
    );

    if (failure) {
      this.logger.error('Failed to subscribe message handlers', failure.reason);
      throw failure.reason;
    }
  }

  private discoverHandlers(): DiscoveredHandler[] {
    return this.distinctProviderInstances().flatMap((instance) =>
      this.handlersOf(instance),
    );
  }

  private distinctProviderInstances(): object[] {
    const instances = this.discoveryService
      .getProviders()
      .filter((wrapper) => this.isSingleton(wrapper))
      .map((wrapper): unknown => wrapper.instance)
      .filter(isObject);

    return [...new Set(instances)];
  }

  private isSingleton(wrapper: ProviderWrapper): boolean {
    return !wrapper.isTransient && wrapper.isDependencyTreeStatic();
  }

  private handlersOf(instance: object): DiscoveredHandler[] {
    return this.annotatedMethodsOf(Object.getPrototypeOf(instance)).map(
      ({ methodName, method, metadata, kind }) => ({
        handlerClass: instance.constructor,
        name: `${instance.constructor.name}.${methodName}`,
        metadata,
        kind,
        handle: method.bind(instance),
      }),
    );
  }

  private annotatedMethodsOf(
    prototype: Record<string, HandlerMethod> | null,
  ): AnnotatedMethod[] {
    if (!prototype) {
      return [];
    }

    return this.metadataScanner
      .getAllMethodNames(prototype)
      .flatMap((methodName) => {
        const method = prototype[methodName];
        const annotations = this.kinds.flatMap((kind) => {
          const metadata: HandlerMetadata | undefined = Reflect.getMetadata(
            kind.metadataKey,
            method,
          );

          return metadata ? [{ methodName, method, metadata, kind }] : [];
        });

        if (annotations.length > 1) {
          throw new Error(
            `Message handler ${prototype.constructor.name}.${methodName} has both @Message and @MessageBatch. ` +
              'Keep one of the two decorators on each method.',
          );
        }

        return annotations;
      });
  }

  private assertNoScopedHandlers(): void {
    const violations = this.discoveryService
      .getProviders()
      .filter((wrapper) => !this.isSingleton(wrapper))
      .flatMap((wrapper) => this.scopedHandlerViolations(wrapper));

    if (violations.length > 0) {
      throw new Error([...new Set(violations)].join('\n'));
    }
  }

  private scopedHandlerViolations(wrapper: ProviderWrapper): string[] {
    const { metatype } = wrapper;

    if (!metatype || wrapper.isFactory) {
      return [];
    }

    const prototype: Record<string, HandlerMethod> | null = metatype.prototype;
    const scope = this.scopeDescription(wrapper);

    return this.annotatedMethodsOf(prototype)
      .filter(({ metadata }) => this.belongsToThisConnector(metadata))
      .map(
        ({ methodName }) =>
          `Message handler ${metatype.name}.${methodName} is on ${scope}, so it can never be subscribed. ` +
          'Make the provider and every provider it injects singleton-scoped.',
      );
  }

  private scopeDescription(wrapper: ProviderWrapper): string {
    if (wrapper.scope === Scope.REQUEST) {
      return 'a request-scoped provider';
    }

    if (wrapper.isTransient) {
      return 'a transient provider';
    }

    return 'a provider that depends on a request-scoped provider';
  }

  private groupsOf(handlers: DiscoveredHandler[]): DiscoveredHandler[][] {
    const byGroupId = new Map<string, DiscoveredHandler[]>();

    for (const handler of handlers) {
      const groupId = handler.metadata[1].groupId;
      byGroupId.set(groupId, [...(byGroupId.get(groupId) ?? []), handler]);
    }

    return [...byGroupId.values()];
  }

  private assertMayShareGroup(group: DiscoveredHandler[]): void {
    if (group.length < 2) {
      return;
    }

    this.assertProvidedOnce(group);

    const challenger = this.firstUnflaggedMember(group);

    if (!challenger) {
      return;
    }

    const owner = group.find((handler) => handler !== challenger);

    throw new Error(
      `Message handlers ${owner?.name} and ${challenger.name} share groupId "${challenger.metadata[1].groupId}". ` +
        'Give each handler its own groupId, or set sharedGroup: true on every handler of the group.',
    );
  }

  private firstUnflaggedMember(
    group: DiscoveredHandler[],
  ): DiscoveredHandler | undefined {
    const [, ...rest] = group;

    return [...rest, group[0]].find(
      (handler) => handler.metadata[1].sharedGroup !== true,
    );
  }

  private assertProvidedOnce(group: DiscoveredHandler[]): void {
    const twin = group.find((handler, index) =>
      group
        .slice(0, index)
        .some((earlier) => this.isSameHandler(earlier, handler)),
    );

    if (twin) {
      throw this.duplicateRegistration(twin.name, twin.metadata[1].groupId);
    }
  }

  private isSameHandler(
    owner: DiscoveredHandler,
    challenger: DiscoveredHandler,
  ): boolean {
    return (
      owner.handlerClass === challenger.handlerClass &&
      owner.name === challenger.name
    );
  }

  private duplicateRegistration(handlerName: string, groupId: string): Error {
    return new Error(
      `Message handler ${handlerName} is provided more than once, by more than one module or ` +
        `under more than one token, so it would subscribe twice with groupId "${groupId}". ` +
        'Provide its class exactly once, export it from that module, and use useExisting ' +
        'for any additional token.',
    );
  }

  private async subscribeGroup(group: DiscoveredHandler[]): Promise<void> {
    const [handler] = group;

    if (group.length === 1) {
      await handler.kind.subscribe(
        this.subscriptionOf(handler),
        handler.handle,
        handler.metadata[1].groupId,
      );
      return;
    }

    await this.sharedGroupConsumer.subscribeGroup(
      handler.metadata[1].groupId,
      group.map((member) => this.routeOf(member)),
    );
  }

  private routeOf(handler: DiscoveredHandler): SharedGroupRoute {
    return {
      handlerName: handler.name,
      subscription: this.subscriptionOf(handler),
      delivery: handler.kind.delivery(handler.handle),
    };
  }

  private subscriptionOf({
    metadata: [topicPatterns, options],
  }: DiscoveredHandler): ConsumerSubscriptionParameters {
    return {
      topicPatterns,
      messageFormat: options.messageFormat,
      errorHandling: options.errorHandling,
      consumer: options.consumer,
      namespaced: options.namespaced,
    };
  }

  private belongsToThisConnector(metadata: HandlerMetadata): boolean {
    return (metadata[1]?.connectorName ?? undefined) === this.connectorName;
  }
}
