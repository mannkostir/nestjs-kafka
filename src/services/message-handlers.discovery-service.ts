import { DiscoveryService } from '@golevelup/nestjs-discovery';
import { Inject, Injectable, OnApplicationBootstrap } from '@nestjs/common';
import { isObject } from '@nestjs/common/utils/shared.utils';

import { ConsumerProxy } from '../base/consumer-proxy';
import {
  Message,
  MessageHandlerKey,
} from '../decorators/message-handler.decorator';
import { MessageFormat } from '../types/message-format.type';


@Injectable()
export class MessageHandlersDiscoveryService implements OnApplicationBootstrap {
  constructor(
    private readonly consumerProxy: ConsumerProxy,
    private readonly discoveryService: DiscoveryService,
    @Inject('module_name') private readonly moduleName: string,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    return this.mapEventsToHandlers();
  }

  private async mapEventsToHandlers(): Promise<void> {
    const discoveredHandlers =
      await this.discoveryService.providerMethodsWithMetaAtKey<
        Parameters<typeof Message>
      >(MessageHandlerKey, (provider) => {
        if (isObject(provider.instance)) {
          return provider.parentModule.name === this.moduleName;
        }

        return false;
      });

    const promises = discoveredHandlers.map(async (handler) => {
      const parameters = handler.meta;
      const topicPatterns = parameters[0];
      const options = parameters[1] || {};
      const method = handler.discoveredMethod.handler;
      const methodContext = handler.discoveredMethod.parentClass.instance;
      
      await this.consumerProxy.subscribe(
        {
          topicPatterns,
          messageFormat: options.messageFormat ?? MessageFormat.JSON,
          errorHandling: options.errorHandling,
        },
        method.bind(methodContext),
        options.groupId,
      );
    });

    await Promise.all(promises).catch((e) => {
      console.error(e);
      throw e;
    });
  }
}
