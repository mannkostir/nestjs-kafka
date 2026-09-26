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
import {
  Message,
  MessageHandlerKey,
} from '../decorators/message-handler.decorator.js';
import { MessageFormat } from '../types/message-format.type.js';
import { MessageHandlerCallback } from '../types/message-handler-callback.type.js';
import { MessageType } from '../types/message.type.js';
import { CONNECTOR_NAME } from '../tokens.js';

type HandlerMetadata = Parameters<typeof Message>;

type HandlerMethod = MessageHandlerCallback<MessageType>;

type ProviderWrapper = ReturnType<DiscoveryService['getProviders']>[number];

type AnnotatedMethod = {
  methodName: string;
  method: HandlerMethod;
  metadata: HandlerMetadata;
};

type DiscoveredHandler = {
  handlerClass: Function;
  name: string;
  metadata: HandlerMetadata;
  handle: HandlerMethod;
};

const isObject = (value: unknown): value is object =>
  typeof value === 'object' && value !== null;

@Injectable()
export class MessageHandlersDiscoveryService implements OnApplicationBootstrap {
  private readonly logger = new Logger(MessageHandlersDiscoveryService.name);

  constructor(
    private readonly consumerProxy: ConsumerProxy,
    private readonly discoveryService: DiscoveryService,
    private readonly metadataScanner: MetadataScanner,
    @Optional()
    @Inject(CONNECTOR_NAME)
    private readonly connectorName?: string,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    return this.mapEventsToHandlers();
  }

  private async mapEventsToHandlers(): Promise<void> {
    this.assertNoScopedHandlers();

    const handlers = this.discoverHandlers().filter((handler) =>
      this.belongsToThisConnector(handler.metadata),
    );

    this.assertUniqueGroupIds(handlers);

    const promises = handlers.map((handler) => this.subscribe(handler));

    try {
      await Promise.all(promises);
    } catch (error) {
      this.logger.error('Failed to subscribe message handlers', error);
      throw error;
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
      ({ methodName, method, metadata }) => ({
        handlerClass: instance.constructor,
        name: `${instance.constructor.name}.${methodName}`,
        metadata,
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
        const metadata: HandlerMetadata | undefined = Reflect.getMetadata(
          MessageHandlerKey,
          method,
        );

        return metadata ? [{ methodName, method, metadata }] : [];
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

  private assertUniqueGroupIds(handlers: DiscoveredHandler[]): void {
    const ownerByGroupId = new Map<string, DiscoveredHandler>();

    for (const handler of handlers) {
      const groupId = handler.metadata[1].groupId;
      const owner = ownerByGroupId.get(groupId);

      if (owner) {
        throw this.groupIdCollision(owner, handler, groupId);
      }

      ownerByGroupId.set(groupId, handler);
    }
  }

  private groupIdCollision(
    owner: DiscoveredHandler,
    challenger: DiscoveredHandler,
    groupId: string,
  ): Error {
    return this.isSameHandler(owner, challenger)
      ? this.duplicateRegistration(owner.name, groupId)
      : new Error(
          `Message handlers ${owner.name} and ${challenger.name} share groupId "${groupId}". ` +
            'Give each @Message handler its own groupId.',
        );
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

  private async subscribe(handler: DiscoveredHandler): Promise<void> {
    const [topicPatterns, options] = handler.metadata;

    await this.consumerProxy.subscribe(
      {
        topicPatterns,
        messageFormat: options.messageFormat ?? MessageFormat.JSON,
        errorHandling: options.errorHandling,
        consumer: options.consumer,
        namespaced: options.namespaced,
      },
      handler.handle,
      options.groupId,
    );
  }

  private belongsToThisConnector(metadata: HandlerMetadata): boolean {
    return (metadata[1]?.connectorName ?? undefined) === this.connectorName;
  }
}
