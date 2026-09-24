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
    const promises = this.discoverHandlers()
      .filter((handler) => this.belongsToThisConnector(handler.metadata))
      .map((handler) => this.subscribe(handler));

    try {
      await Promise.all(promises);
    } catch (error) {
      this.logger.error('Failed to subscribe message handlers', error);
      throw error;
    }
  }

  private discoverHandlers(): DiscoveredHandler[] {
    return this.discoveryService
      .getProviders()
      .filter((wrapper) => wrapper.isDependencyTreeStatic())
      .map((wrapper): unknown => wrapper.instance)
      .filter(isObject)
      .flatMap((instance) => this.handlersOf(instance));
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

        return metadata ? [{ metadata, handle: method.bind(instance) }] : [];
      });
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
