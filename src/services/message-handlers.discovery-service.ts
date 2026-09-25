import {
  Inject,
  Injectable,
  Logger,
  OnApplicationBootstrap,
  Optional,
} from '@nestjs/common';
import { DiscoveryService, MetadataScanner } from '@nestjs/core';

import { ConsumerProxy } from '../base/consumer-proxy';
import {
  Message,
  MessageHandlerKey,
} from '../decorators/message-handler.decorator';
import { MessageFormat } from '../types/message-format.type';
import { MessageHandlerCallback } from '../types/message-handler-callback.type';
import { MessageType } from '../types/message.type';
import { CONNECTOR_NAME } from '../tokens';

type HandlerMetadata = Parameters<typeof Message>;

type HandlerMethod = MessageHandlerCallback<MessageType>;

type DiscoveredHandler = {
  declaringClass: Function;
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
      .filter((wrapper) => wrapper.isDependencyTreeStatic())
      .map((wrapper): unknown => wrapper.instance)
      .filter(isObject);

    return [...new Set(instances)];
  }

  private handlersOf(instance: object): DiscoveredHandler[] {
    const prototype: Record<string, HandlerMethod> | null =
      Object.getPrototypeOf(instance);

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

        return metadata
          ? [
              {
                declaringClass: instance.constructor,
                name: `${instance.constructor.name}.${methodName}`,
                metadata,
                handle: method.bind(instance),
              },
            ]
          : [];
      });
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
      owner.declaringClass === challenger.declaringClass &&
      owner.name === challenger.name
    );
  }

  private duplicateRegistration(handlerName: string, groupId: string): Error {
    return new Error(
      `Message handler ${handlerName} is registered as a provider in more than one module, ` +
        `so it would subscribe twice with groupId "${groupId}". ` +
        'Register its class as a provider in exactly one module, export it from that module, ' +
        'and import that module wherever the provider is needed.',
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
