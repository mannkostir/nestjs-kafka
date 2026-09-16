import { DiscoveryService } from '@golevelup/nestjs-discovery';
import { ConsumerProxy } from '../base/consumer-proxy';
import { MessageFormat } from '../types/message-format.type';
import { MessageHandlersDiscoveryService } from './message-handlers.discovery-service';

const handler = (meta: unknown[], name = 'handle') => ({
  meta,
  discoveredMethod: {
    handler: jest.fn(),
    methodName: name,
    parentClass: { instance: {} },
  },
});

const discoveryStub = (handlers: unknown[]) =>
  ({
    providerMethodsWithMetaAtKey: jest.fn().mockResolvedValue(handlers),
  }) as unknown as DiscoveryService;

const consumerStub = () =>
  ({ subscribe: jest.fn().mockResolvedValue(undefined) }) as unknown as ConsumerProxy;

describe('MessageHandlersDiscoveryService', () => {
  it('subscribes a handler discovered anywhere in the application', async () => {
    const consumer = consumerStub();
    const discovery = discoveryStub([
      handler([
        ['orders.created'],
        { groupId: 'orders-service', errorHandling: { type: 'fail' } },
      ]),
    ]);

    await new MessageHandlersDiscoveryService(
      consumer,
      discovery,
    ).onApplicationBootstrap();

    expect(consumer.subscribe).toHaveBeenCalledWith(
      expect.objectContaining({
        topicPatterns: ['orders.created'],
        messageFormat: MessageFormat.JSON,
      }),
      expect.any(Function),
      'orders-service',
    );
  });

  it('defaults the message format to json when the handler omits it', async () => {
    const consumer = consumerStub();
    const discovery = discoveryStub([
      handler([
        ['orders.created'],
        { groupId: 'orders-service', errorHandling: { type: 'fail' } },
      ]),
    ]);

    await new MessageHandlersDiscoveryService(
      consumer,
      discovery,
    ).onApplicationBootstrap();

    expect(consumer.subscribe).toHaveBeenCalledWith(
      expect.objectContaining({ messageFormat: MessageFormat.JSON }),
      expect.any(Function),
      'orders-service',
    );
  });

  it('subscribes only handlers matching the configured connector name', async () => {
    const consumer = consumerStub();
    const discovery = discoveryStub([
      handler(
        [
          ['orders.created'],
          {
            groupId: 'orders-service',
            errorHandling: { type: 'fail' },
            connectorName: 'primary',
          },
        ],
        'primary',
      ),
      handler(
        [
          ['audit.created'],
          {
            groupId: 'audit-service',
            errorHandling: { type: 'fail' },
            connectorName: 'secondary',
          },
        ],
        'secondary',
      ),
    ]);

    await new MessageHandlersDiscoveryService(
      consumer,
      discovery,
      'primary',
    ).onApplicationBootstrap();

    expect(consumer.subscribe).toHaveBeenCalledTimes(1);
    expect(consumer.subscribe).toHaveBeenCalledWith(
      expect.objectContaining({ topicPatterns: ['orders.created'] }),
      expect.any(Function),
      'orders-service',
    );
  });

  it('subscribes only unnamed handlers when no connector name is configured', async () => {
    const consumer = consumerStub();
    const discovery = discoveryStub([
      handler([
        ['orders.created'],
        { groupId: 'orders-service', errorHandling: { type: 'fail' } },
      ]),
      handler(
        [
          ['audit.created'],
          {
            groupId: 'audit-service',
            errorHandling: { type: 'fail' },
            connectorName: 'secondary',
          },
        ],
        'secondary',
      ),
    ]);

    await new MessageHandlersDiscoveryService(
      consumer,
      discovery,
    ).onApplicationBootstrap();

    expect(consumer.subscribe).toHaveBeenCalledTimes(1);
    expect(consumer.subscribe).toHaveBeenCalledWith(
      expect.objectContaining({ topicPatterns: ['orders.created'] }),
      expect.any(Function),
      'orders-service',
    );
  });

  it('does not filter discovery by parent module', async () => {
    const consumer = consumerStub();
    const discovery = discoveryStub([]);

    await new MessageHandlersDiscoveryService(
      consumer,
      discovery,
    ).onApplicationBootstrap();

    expect(discovery.providerMethodsWithMetaAtKey).toHaveBeenCalledWith(
      'HANDLE_MESSAGE',
    );
  });
});
