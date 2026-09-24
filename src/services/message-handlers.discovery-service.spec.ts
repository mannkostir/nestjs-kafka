import { Injectable, Logger, Module, Provider, Type } from '@nestjs/common';
import { DiscoveryModule } from '@nestjs/core';
import { Test, TestingModule } from '@nestjs/testing';
import { ConsumerProxy } from '../base/consumer-proxy';
import { Message } from '../decorators/message-handler.decorator';
import { MessageFormat } from '../types/message-format.type';
import { MessageType } from '../types/message.type';
import { CONNECTOR_NAME } from '../tokens';
import { MessageHandlersDiscoveryService } from './message-handlers.discovery-service';

@Injectable()
class OrdersHandler {
  public readonly handled: MessageType[] = [];

  @Message(['orders.created'], {
    groupId: 'orders-service',
    errorHandling: { type: 'fail' },
  })
  async onOrderCreated(message: MessageType): Promise<void> {
    this.handled.push(message);
  }
}

@Injectable()
class AvroNonNamespacedHandler {
  @Message(['payments.settled'], {
    groupId: 'payments-service',
    errorHandling: { type: 'ignore' },
    messageFormat: MessageFormat.AVRO,
    namespaced: false,
  })
  async onPaymentSettled(): Promise<void> {}
}

@Injectable()
class PrimaryHandler {
  @Message(['primary.events'], {
    groupId: 'primary-service',
    errorHandling: { type: 'fail' },
    connectorName: 'primary',
  })
  async onPrimaryEvent(): Promise<void> {}
}

@Injectable()
class SecondaryHandler {
  @Message(['secondary.events'], {
    groupId: 'secondary-service',
    errorHandling: { type: 'fail' },
    connectorName: 'secondary',
  })
  async onSecondaryEvent(): Promise<void> {}
}

@Injectable()
class UnannotatedService {
  async doWork(): Promise<void> {}
}

@Module({ providers: [OrdersHandler] })
class OrdersFeatureModule {}

type Harness = {
  subscribe: jest.Mock;
  bootstrap: () => Promise<TestingModule>;
};

const harness = (
  handlers: Type[],
  options: { connectorName?: string; imports?: Type[] } = {},
): Harness => {
  const subscribe = jest.fn().mockResolvedValue(undefined);
  const connectorProviders: Provider[] =
    options.connectorName === undefined
      ? []
      : [{ provide: CONNECTOR_NAME, useValue: options.connectorName }];

  const bootstrap = async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [DiscoveryModule, ...(options.imports ?? [])],
      providers: [
        ...handlers,
        ...connectorProviders,
        { provide: ConsumerProxy, useValue: { subscribe } },
        MessageHandlersDiscoveryService,
      ],
    }).compile();

    return moduleRef.init();
  };

  return { subscribe, bootstrap };
};

const subscribedTopics = (subscribe: jest.Mock): string[][] =>
  subscribe.mock.calls.map(([subscription]) => subscription.topicPatterns);

describe('MessageHandlersDiscoveryService', () => {
  it('subscribes a handler declared in any module of the application', async () => {
    const { subscribe, bootstrap } = harness([], {
      imports: [OrdersFeatureModule],
    });

    await bootstrap();

    expect(subscribe).toHaveBeenCalledWith(
      expect.objectContaining({ topicPatterns: ['orders.created'] }),
      expect.any(Function),
      'orders-service',
    );
  });

  it('defaults the message format to json when the handler omits it', async () => {
    const { subscribe, bootstrap } = harness([OrdersHandler]);

    await bootstrap();

    expect(subscribe).toHaveBeenCalledWith(
      expect.objectContaining({ messageFormat: MessageFormat.JSON }),
      expect.any(Function),
      'orders-service',
    );
  });

  it('passes the handler options through to the subscription', async () => {
    const { subscribe, bootstrap } = harness([AvroNonNamespacedHandler]);

    await bootstrap();

    expect(subscribe).toHaveBeenCalledWith(
      {
        topicPatterns: ['payments.settled'],
        messageFormat: MessageFormat.AVRO,
        errorHandling: { type: 'ignore' },
        consumer: undefined,
        namespaced: false,
      },
      expect.any(Function),
      'payments-service',
    );
  });

  it('invokes the handler method bound to its provider instance', async () => {
    const { subscribe, bootstrap } = harness([OrdersHandler]);
    const message: MessageType = { key: null, value: null };

    const app = await bootstrap();
    const [, callback] = subscribe.mock.calls[0];
    await callback(message, 'orders.created');

    expect(app.get(OrdersHandler).handled).toEqual([message]);
  });

  it('ignores providers without message handlers', async () => {
    const { subscribe, bootstrap } = harness([UnannotatedService]);

    await bootstrap();

    expect(subscribe).not.toHaveBeenCalled();
  });

  it('subscribes a handler whose connector name matches the module connector name', async () => {
    const { subscribe, bootstrap } = harness([PrimaryHandler], {
      connectorName: 'primary',
    });

    await bootstrap();

    expect(subscribedTopics(subscribe)).toEqual([['primary.events']]);
  });

  it('does not subscribe a handler named for a different connector', async () => {
    const { subscribe, bootstrap } = harness([SecondaryHandler], {
      connectorName: 'primary',
    });

    await bootstrap();

    expect(subscribe).not.toHaveBeenCalled();
  });

  it('does not subscribe an unnamed handler when a connector name is configured', async () => {
    const { subscribe, bootstrap } = harness([OrdersHandler], {
      connectorName: 'primary',
    });

    await bootstrap();

    expect(subscribe).not.toHaveBeenCalled();
  });

  it('subscribes an unnamed handler when no connector name is configured', async () => {
    const { subscribe, bootstrap } = harness([OrdersHandler]);

    await bootstrap();

    expect(subscribedTopics(subscribe)).toEqual([['orders.created']]);
  });

  it('does not subscribe a named handler when no connector name is configured', async () => {
    const { subscribe, bootstrap } = harness([PrimaryHandler]);

    await bootstrap();

    expect(subscribe).not.toHaveBeenCalled();
  });

  it('logs and rethrows when a subscription fails', async () => {
    const failure = new Error('broker unavailable');
    const { subscribe, bootstrap } = harness([OrdersHandler]);
    subscribe.mockRejectedValue(failure);
    const logError = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);

    await expect(bootstrap()).rejects.toBe(failure);

    expect(logError).toHaveBeenCalledWith(
      'Failed to subscribe message handlers',
      failure,
    );
    logError.mockRestore();
  });
});
