import { DiscoveryService } from '@golevelup/nestjs-discovery';
import {
  Inject,
  Injectable,
  Logger,
  OnApplicationBootstrap,
  Optional,
} from '@nestjs/common';

import { ConsumerProxy } from '../base/consumer-proxy';
import {
  Message,
  MessageHandlerKey,
} from '../decorators/message-handler.decorator';
import { MessageFormat } from '../types/message-format.type';
import { CONNECTOR_NAME } from '../tokens';

@Injectable()
export class MessageHandlersDiscoveryService implements OnApplicationBootstrap {
  private readonly logger = new Logger(MessageHandlersDiscoveryService.name);

  constructor(
    private readonly consumerProxy: ConsumerProxy,
    private readonly discoveryService: DiscoveryService,
    @Optional()
    @Inject(CONNECTOR_NAME)
    private readonly connectorName?: string,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    return this.mapEventsToHandlers();
  }

  private async mapEventsToHandlers(): Promise<void> {
    const discoveredHandlers =
      await this.discoveryService.providerMethodsWithMetaAtKey<
        Parameters<typeof Message>
      >(MessageHandlerKey);

    const promises = discoveredHandlers
      .filter((handler) => this.belongsToThisConnector(handler.meta))
      .map(async (handler) => {
        const [topicPatterns, options] = handler.meta;
        const method = handler.discoveredMethod.handler;
        const methodContext = handler.discoveredMethod.parentClass.instance;

        await this.consumerProxy.subscribe(
          {
            topicPatterns,
            messageFormat: options.messageFormat ?? MessageFormat.JSON,
            errorHandling: options.errorHandling,
            consumer: options.consumer,
            namespaced: options.namespaced,
          },
          method.bind(methodContext),
          options.groupId,
        );
      });

    try {
      await Promise.all(promises);
    } catch (error) {
      this.logger.error('Failed to subscribe message handlers', error);
      throw error;
    }
  }

  private belongsToThisConnector(
    meta: Parameters<typeof Message>,
  ): boolean {
    return (meta[1]?.connectorName ?? undefined) === this.connectorName;
  }
}
