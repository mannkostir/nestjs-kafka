import {
  Injectable,
  Logger,
  Module,
  Provider,
  Scope,
  Type,
} from '@nestjs/common';
import { DiscoveryModule } from '@nestjs/core';
import { Test, TestingModule } from '@nestjs/testing';
import { ConsumerProxy } from '../base/consumer-proxy.js';
import { Message } from '../decorators/message-handler.decorator.js';
import { MessageBatch } from '../decorators/message-batch-handler.decorator.js';
import { ReceivedMessage } from '../types/received-message.type.js';
import { MessageFormat } from '../types/message-format.type.js';
import { MessageContext } from '../types/message-context.type.js';
import { MessageType } from '../types/message.type.js';
import {
  BATCH_CONSUMER,
  CONNECTOR_NAME,
  KAFKA_CONNECTIONS,
  SHARED_GROUP_CONSUMER,
} from '../tokens.js';
import { MessageHandlersDiscoveryService } from './message-handlers.discovery-service.js';

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
class ContextRecordingHandler {
  public readonly contexts: MessageContext[] = [];

  @Message(['orders.created'], {
    groupId: 'context-service',
    errorHandling: { type: 'fail' },
  })
  async handle(_message: MessageType, context: MessageContext): Promise<void> {
    this.contexts.push(context);
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

@Injectable()
class InvoicesHandler {
  @Message(['invoices.issued'], {
    groupId: 'shared-group',
    errorHandling: { type: 'fail' },
  })
  async onInvoiceIssued(): Promise<void> {}
}

@Injectable()
class RefundsHandler {
  @Message(['refunds.issued'], {
    groupId: 'shared-group',
    errorHandling: { type: 'fail' },
  })
  async onRefundIssued(): Promise<void> {}
}

@Injectable()
class PrimarySharedGroupHandler {
  @Message(['primary.shared'], {
    groupId: 'shared-group',
    errorHandling: { type: 'fail' },
    connectorName: 'primary',
  })
  async onPrimaryShared(): Promise<void> {}
}

@Injectable()
class SecondarySharedGroupHandler {
  @Message(['secondary.shared'], {
    groupId: 'shared-group',
    errorHandling: { type: 'fail' },
    connectorName: 'secondary',
  })
  async onSecondaryShared(): Promise<void> {}
}

const LookalikeOrdersHandler = (() => {
  @Injectable()
  class OrdersHandler {
    @Message(['orders.archived'], {
      groupId: 'orders-service',
      errorHandling: { type: 'fail' },
    })
    async onOrderCreated(): Promise<void> {}
  }

  return OrdersHandler;
})();

@Injectable()
class ArchiveHandler {
  @Message(['orders.archived'], {
    groupId: 'archive-service',
    errorHandling: { type: 'fail' },
  })
  async onArchived(): Promise<void> {}
}

@Injectable()
class ColdArchiveHandler extends ArchiveHandler {}

@Injectable({ scope: Scope.REQUEST })
class RequestScopedAuditHandler {
  @Message(['audit.logged'], {
    groupId: 'audit-service',
    errorHandling: { type: 'fail' },
  })
  async onAuditLogged(): Promise<void> {}
}

@Injectable({ scope: Scope.TRANSIENT })
class TransientMetricsHandler {
  @Message(['metrics.recorded'], {
    groupId: 'metrics-service',
    errorHandling: { type: 'fail' },
  })
  async onMetricRecorded(): Promise<void> {}
}

@Injectable({ scope: Scope.REQUEST })
class RequestContext {}

@Injectable()
class SessionsHandler {
  constructor(readonly context: RequestContext) {}

  @Message(['sessions.opened'], {
    groupId: 'sessions-service',
    errorHandling: { type: 'fail' },
  })
  async onSessionOpened(): Promise<void> {}
}

@Injectable({ scope: Scope.TRANSIENT })
class TransientClock {}

@Injectable()
class ShipmentsHandler {
  constructor(readonly clock: TransientClock) {}

  @Message(['shipments.dispatched'], {
    groupId: 'shipments-service',
    errorHandling: { type: 'fail' },
  })
  async onShipmentDispatched(): Promise<void> {}
}

@Injectable()
class ReturnsHandler {
  @Message(['returns.received'], {
    groupId: 'returns-service',
    errorHandling: { type: 'fail' },
  })
  async onReturnReceived(): Promise<void> {}
}

@Module({ providers: [RequestScopedAuditHandler] })
class AuditFeatureModule {}

@Module({ providers: [RequestScopedAuditHandler] })
class ComplianceFeatureModule {}

@Injectable({ scope: Scope.REQUEST })
class RequestScopedService {
  async doWork(): Promise<void> {}
}

@Injectable({ scope: Scope.REQUEST })
class RequestScopedSecondaryHandler {
  @Message(['secondary.audited'], {
    groupId: 'secondary-audit-service',
    errorHandling: { type: 'fail' },
    connectorName: 'secondary',
  })
  async onSecondaryAudited(): Promise<void> {}
}

@Module({ providers: [OrdersHandler] })
class OrdersFeatureModule {}

@Module({ providers: [OrdersHandler] })
class ReportingFeatureModule {}

@Injectable()
class OrdersIndexer {
  public readonly receivers: unknown[] = [];

  @MessageBatch(['orders.created'], {
    groupId: 'orders-indexer',
    errorHandling: { type: 'dlq' },
  })
  async index(_batch: ReceivedMessage[]): Promise<void> {
    this.receivers.push(this);
  }
}

@Injectable()
class SharedGroupIndexer {
  @MessageBatch(['orders.created'], {
    groupId: 'orders-service',
    errorHandling: { type: 'fail' },
  })
  async index(_batch: ReceivedMessage[]): Promise<void> {}
}

@Injectable()
class SecondaryIndexer {
  @MessageBatch(['secondary.events'], {
    groupId: 'secondary-indexer',
    errorHandling: { type: 'fail' },
    connectorName: 'secondary',
  })
  async index(_batch: ReceivedMessage[]): Promise<void> {}
}

@Injectable({ scope: Scope.REQUEST })
class RequestScopedIndexer {
  @MessageBatch(['audit.events'], {
    groupId: 'audit-indexer',
    errorHandling: { type: 'fail' },
  })
  async index(_batch: ReceivedMessage[]): Promise<void> {}
}

const DoublyDecoratedHandler = (() => {
  @Injectable()
  class DoublyDecoratedHandler {
    @Message(['orders.created'], {
      groupId: 'orders-double',
      errorHandling: { type: 'fail' },
    })
    @MessageBatch(['orders.created'], {
      groupId: 'orders-double-batch',
      errorHandling: { type: 'fail' },
    })
    async handle(_batch: ReceivedMessage[]): Promise<void> {}
  }

  return DoublyDecoratedHandler;
})();

@Injectable()
class SharedOrdersHandler {
  public readonly receivers: unknown[] = [];

  @Message(['billing.orders'], {
    groupId: 'billing',
    errorHandling: { type: 'fail' },
    sharedGroup: true,
  })
  async onOrder(): Promise<void> {
    this.receivers.push(this);
  }
}

@Injectable()
class SharedRefundsIndexer {
  @MessageBatch(['billing.refunds'], {
    groupId: 'billing',
    errorHandling: { type: 'dlq' },
    sharedGroup: true,
  })
  async index(_batch: ReceivedMessage[]): Promise<void> {}
}

@Injectable()
class UnflaggedBillingHandler {
  @Message(['billing.invoices'], {
    groupId: 'billing',
    errorHandling: { type: 'fail' },
  })
  async onInvoice(): Promise<void> {}
}

@Injectable()
class ExplicitlyUnsharedInvoices {
  @Message(['invoices.issued'], {
    groupId: 'unshared',
    errorHandling: { type: 'fail' },
    sharedGroup: false,
  })
  async onInvoice(): Promise<void> {}
}

@Injectable()
class ExplicitlyUnsharedRefunds {
  @Message(['refunds.issued'], {
    groupId: 'unshared',
    errorHandling: { type: 'fail' },
    sharedGroup: false,
  })
  async onRefund(): Promise<void> {}
}

@Module({ providers: [SharedOrdersHandler] })
class SharedOrdersModuleA {}

@Module({ providers: [SharedOrdersHandler] })
class SharedOrdersModuleB {}

type Harness = {
  subscribe: jest.Mock;
  subscribeBatch: jest.Mock;
  subscribeGroup: jest.Mock;
  releaseConnections: jest.Mock;
  bootstrap: () => Promise<TestingModule>;
};

const harness = (
  handlers: Provider[],
  options: { connectorName?: string; imports?: Type[] } = {},
): Harness => {
  const subscribe = jest.fn().mockResolvedValue(undefined);
  const subscribeBatch = jest.fn().mockResolvedValue(undefined);
  const subscribeGroup = jest.fn().mockResolvedValue(undefined);
  const releaseConnections = jest.fn().mockResolvedValue(undefined);
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
        { provide: BATCH_CONSUMER, useValue: { subscribeBatch } },
        { provide: SHARED_GROUP_CONSUMER, useValue: { subscribeGroup } },
        { provide: KAFKA_CONNECTIONS, useValue: { releaseConnections } },
        MessageHandlersDiscoveryService,
      ],
    }).compile();

    return moduleRef.init();
  };

  return {
    subscribe,
    subscribeBatch,
    subscribeGroup,
    releaseConnections,
    bootstrap,
  };
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

  it('leaves the message format to the connector when the handler omits it', async () => {
    const { subscribe, bootstrap } = harness([OrdersHandler]);

    await bootstrap();

    expect(subscribe).toHaveBeenCalledWith(
      expect.objectContaining({ messageFormat: undefined }),
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
    await callback(message, { topic: 'orders.created', partition: 0, offset: '0', timestamp: '0' });

    expect(app.get(OrdersHandler).handled).toEqual([message]);
  });

  it('passes the message context through to the handler method', async () => {
    const { subscribe, bootstrap } = harness([ContextRecordingHandler]);
    const context: MessageContext = {
      topic: 'orders.created',
      partition: 2,
      offset: '17',
      timestamp: '1700000000000',
    };

    const app = await bootstrap();
    const [, callback] = subscribe.mock.calls[0];
    await callback({ key: null, value: null }, context);

    expect(app.get(ContextRecordingHandler).contexts).toEqual([context]);
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

  it('rejects bootstrap naming the group id and both handlers when two handlers share a group id', async () => {
    const { bootstrap } = harness([InvoicesHandler, RefundsHandler]);

    await expect(bootstrap()).rejects.toThrow(
      'Message handlers InvoicesHandler.onInvoiceIssued and RefundsHandler.onRefundIssued share groupId "shared-group". Give each handler its own groupId, or set sharedGroup: true on every handler of the group.',
    );
  });

  it('subscribes nothing when two handlers share a group id', async () => {
    const { subscribe, bootstrap } = harness([InvoicesHandler, RefundsHandler]);

    await bootstrap().catch(() => undefined);

    expect(subscribe).not.toHaveBeenCalled();
  });

  it('subscribes every handler when their group ids are distinct', async () => {
    const { subscribe, bootstrap } = harness([
      OrdersHandler,
      AvroNonNamespacedHandler,
    ]);

    await bootstrap();

    expect(subscribe).toHaveBeenCalledTimes(2);
  });

  it('allows handlers on different connectors to share a group id', async () => {
    const { subscribe, bootstrap } = harness(
      [PrimarySharedGroupHandler, SecondarySharedGroupHandler],
      { connectorName: 'primary' },
    );

    await bootstrap();

    expect(subscribedTopics(subscribe)).toEqual([['primary.shared']]);
  });

  it('subscribes an aliased handler only once', async () => {
    const { subscribe, bootstrap } = harness([
      OrdersHandler,
      { provide: 'ORDERS_HANDLER_ALIAS', useExisting: OrdersHandler },
    ]);

    await bootstrap();

    expect(subscribe).toHaveBeenCalledTimes(1);
  });

  it('rejects bootstrap explaining the duplicate registration when one handler class is provided by two modules', async () => {
    const { bootstrap } = harness([], {
      imports: [OrdersFeatureModule, ReportingFeatureModule],
    });

    await expect(bootstrap()).rejects.toThrow(
      /OrdersHandler\.onOrderCreated is provided more than once[\s\S]*groupId "orders-service"[\s\S]*exactly once/,
    );
  });

  it('rejects bootstrap explaining the duplicate registration when one module provides a handler class under two tokens', async () => {
    const { bootstrap } = harness([
      OrdersHandler,
      { provide: 'ORDERS_HANDLER_COPY', useClass: OrdersHandler },
    ]);

    await expect(bootstrap()).rejects.toThrow(
      /OrdersHandler\.onOrderCreated is provided more than once/,
    );
  });

  it('reports a shared group id when a subclass inherits a handler from a provided base class', async () => {
    const { bootstrap } = harness([ArchiveHandler, ColdArchiveHandler]);

    await expect(bootstrap()).rejects.toThrow(
      'Message handlers ArchiveHandler.onArchived and ColdArchiveHandler.onArchived share groupId "archive-service"',
    );
  });

  it('reports a shared group id when two distinct classes share a name', async () => {
    const { bootstrap } = harness([OrdersHandler, LookalikeOrdersHandler]);

    await expect(bootstrap()).rejects.toThrow(
      'Message handlers OrdersHandler.onOrderCreated and OrdersHandler.onOrderCreated share groupId "orders-service"',
    );
  });
  it('rejects bootstrap naming a handler on a request-scoped provider and how to fix it', async () => {
    const { bootstrap } = harness([RequestScopedAuditHandler]);

    await expect(bootstrap()).rejects.toThrow(
      'Message handler RequestScopedAuditHandler.onAuditLogged is on a request-scoped provider, so it can never be subscribed. Make the provider and every provider it injects singleton-scoped.',
    );
  });

  it('rejects bootstrap naming a handler on a transient provider', async () => {
    const { bootstrap } = harness([TransientMetricsHandler]);

    await expect(bootstrap()).rejects.toThrow(
      'Message handler TransientMetricsHandler.onMetricRecorded is on a transient provider',
    );
  });

  it('rejects bootstrap naming a handler whose provider depends on a request-scoped provider', async () => {
    const { bootstrap } = harness([RequestContext, SessionsHandler]);

    await expect(bootstrap()).rejects.toThrow(
      'Message handler SessionsHandler.onSessionOpened is on a provider that depends on a request-scoped provider',
    );
  });

  it('rejects bootstrap naming a handler on a provider registered with a request scope', async () => {
    const { bootstrap } = harness([
      { provide: ReturnsHandler, useClass: ReturnsHandler, scope: Scope.REQUEST },
    ]);

    await expect(bootstrap()).rejects.toThrow(
      'Message handler ReturnsHandler.onReturnReceived is on a request-scoped provider',
    );
  });

  it('rejects bootstrap naming the first of several handlers on scoped providers', async () => {
    const { bootstrap } = harness([
      RequestScopedAuditHandler,
      TransientMetricsHandler,
    ]);

    await expect(bootstrap()).rejects.toThrow(
      'RequestScopedAuditHandler.onAuditLogged',
    );
  });

  it('rejects bootstrap naming the second of several handlers on scoped providers', async () => {
    const { bootstrap } = harness([
      RequestScopedAuditHandler,
      TransientMetricsHandler,
    ]);

    await expect(bootstrap()).rejects.toThrow(
      'TransientMetricsHandler.onMetricRecorded',
    );
  });

  it('names a scoped handler once when it is also aliased', async () => {
    const { bootstrap } = harness([
      RequestScopedAuditHandler,
      { provide: 'AUDIT_HANDLER_ALIAS', useExisting: RequestScopedAuditHandler },
    ]);

    await expect(bootstrap()).rejects.toThrow(
      /^Message handler RequestScopedAuditHandler\.onAuditLogged[^\n]*$/,
    );
  });

  it('names a scoped handler once when two modules provide it', async () => {
    const { bootstrap } = harness([], {
      imports: [AuditFeatureModule, ComplianceFeatureModule],
    });

    await expect(bootstrap()).rejects.toThrow(
      /^Message handler RequestScopedAuditHandler\.onAuditLogged[^\n]*$/,
    );
  });

  it('subscribes nothing when a handler is on a scoped provider', async () => {
    const { subscribe, bootstrap } = harness([
      OrdersHandler,
      RequestScopedAuditHandler,
    ]);

    await expect(bootstrap()).rejects.toThrow();

    expect(subscribe).not.toHaveBeenCalled();
  });

  it('subscribes a singleton handler that injects a transient provider', async () => {
    const { subscribe, bootstrap } = harness([TransientClock, ShipmentsHandler]);

    await bootstrap();

    expect(subscribedTopics(subscribe)).toEqual([['shipments.dispatched']]);
  });

  it('ignores a request-scoped factory provider', async () => {
    const { subscribe, bootstrap } = harness([
      OrdersHandler,
      {
        provide: 'SCOPED_RETURNS_HANDLER',
        useFactory: () => new ReturnsHandler(),
        scope: Scope.REQUEST,
      },
    ]);

    await bootstrap();

    expect(subscribedTopics(subscribe)).toEqual([['orders.created']]);
  });

  it('ignores a request-scoped provider without message handlers', async () => {
    const { subscribe, bootstrap } = harness([
      OrdersHandler,
      RequestScopedService,
    ]);

    await bootstrap();

    expect(subscribedTopics(subscribe)).toEqual([['orders.created']]);
  });

  it('ignores a scoped handler named for a different connector', async () => {
    const { subscribe, bootstrap } = harness(
      [PrimaryHandler, RequestScopedSecondaryHandler],
      { connectorName: 'primary' },
    );

    await bootstrap();

    expect(subscribedTopics(subscribe)).toEqual([['primary.events']]);
  });

  it('releases the Kafka connections and rethrows when a handler fails to subscribe', async () => {
    const failure = new Error('broker unavailable');
    const { subscribe, releaseConnections, bootstrap } = harness([OrdersHandler]);
    subscribe.mockRejectedValue(failure);

    await expect(bootstrap()).rejects.toBe(failure);

    expect(releaseConnections).toHaveBeenCalledTimes(1);
  });

  it('waits for in-flight subscriptions to settle before releasing', async () => {
    const failure = new Error('broker unavailable');
    const { subscribe, releaseConnections, bootstrap } = harness([
      OrdersHandler,
      AvroNonNamespacedHandler,
    ]);
    let resolveSecond!: () => void;
    subscribe.mockImplementation((_subscription, _cb, groupId) =>
      groupId === 'orders-service'
        ? Promise.reject(failure)
        : new Promise<void>((resolve) => {
            resolveSecond = resolve;
          }),
    );

    const bootstrapPromise = bootstrap();

    for (let tick = 0; tick < 50 && subscribe.mock.calls.length < 2; tick++) {
      await new Promise((resolve) => setImmediate(resolve));
    }

    expect(subscribe.mock.calls.length).toBe(2);
    expect(releaseConnections).not.toHaveBeenCalled();

    resolveSecond();

    await expect(bootstrapPromise).rejects.toBe(failure);
    expect(releaseConnections).toHaveBeenCalledTimes(1);
  });

  it('releases the Kafka connections when bootstrap fails on duplicate group ids', async () => {
    const { releaseConnections, bootstrap } = harness([
      InvoicesHandler,
      RefundsHandler,
    ]);

    await expect(bootstrap()).rejects.toThrow();

    expect(releaseConnections).toHaveBeenCalledTimes(1);
  });

  it('does not release connections after a successful bootstrap', async () => {
    const { releaseConnections, bootstrap } = harness([OrdersHandler]);

    await bootstrap();

    expect(releaseConnections).not.toHaveBeenCalled();
  });

  it('rethrows the original bootstrap error when releasing connections also fails', async () => {
    const subscribeFailure = new Error('broker unavailable');
    const releaseFailure = new Error('disconnect failed');
    const { subscribe, releaseConnections, bootstrap } = harness([OrdersHandler]);
    subscribe.mockRejectedValue(subscribeFailure);
    releaseConnections.mockRejectedValue(releaseFailure);
    const logError = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);

    await expect(bootstrap()).rejects.toBe(subscribeFailure);

    expect(logError).toHaveBeenCalledWith(
      'Failed to release Kafka connections after a failed bootstrap',
      releaseFailure,
    );
    logError.mockRestore();
  });
});

describe('MessageHandlersDiscoveryService batch handlers', () => {
  it('subscribes a batch handler through the batch port', async () => {
    const { subscribeBatch, bootstrap } = harness([OrdersIndexer]);
    await bootstrap();
    expect(subscribeBatch).toHaveBeenCalledWith(
      expect.objectContaining({
        topicPatterns: ['orders.created'],
        errorHandling: { type: 'dlq' },
      }),
      expect.any(Function),
      'orders-indexer',
    );
  });

  it('does not subscribe a batch handler as a per-message handler', async () => {
    const { subscribe, bootstrap } = harness([OrdersIndexer]);
    await bootstrap();
    expect(subscribe).not.toHaveBeenCalled();
  });

  it('binds the batch handler to its provider instance', async () => {
    const { subscribeBatch, bootstrap } = harness([OrdersIndexer]);
    const moduleRef = await bootstrap();
    const indexer = moduleRef.get(OrdersIndexer);
    const [, callback] = subscribeBatch.mock.calls[0];
    await callback([]);
    expect(indexer.receivers[0]).toBe(indexer);
  });

  it('rejects a batch handler sharing a group id with a per-message handler', async () => {
    const { bootstrap } = harness([OrdersHandler, SharedGroupIndexer]);
    await expect(bootstrap()).rejects.toThrow(/share groupId "orders-service"/);
  });

  it('does not subscribe a batch handler named for a different connector', async () => {
    const { subscribeBatch, bootstrap } = harness([SecondaryIndexer], {
      connectorName: 'primary',
    });
    await bootstrap();
    expect(subscribeBatch).not.toHaveBeenCalled();
  });

  it('rejects a batch handler on a request-scoped provider', async () => {
    const { bootstrap } = harness([RequestScopedIndexer]);
    await expect(bootstrap()).rejects.toThrow(
      /RequestScopedIndexer\.index is on a request-scoped provider/,
    );
  });

  it('rejects a method carrying both decorators', async () => {
    const { bootstrap } = harness([DoublyDecoratedHandler]);
    await expect(bootstrap()).rejects.toThrow(
      /DoublyDecoratedHandler\.handle has both @Message and @MessageBatch/,
    );
  });

  it('releases connections when a batch subscription fails', async () => {
    const { subscribeBatch, releaseConnections, bootstrap } = harness([
      OrdersIndexer,
    ]);
    subscribeBatch.mockRejectedValue(new Error('batch subscribe failed'));
    await expect(bootstrap()).rejects.toThrow('batch subscribe failed');
    expect(releaseConnections).toHaveBeenCalledTimes(1);
  });
});

describe('MessageHandlersDiscoveryService shared groups', () => {
  it('subscribes a lone flagged handler through its own port', async () => {
    const { subscribe, subscribeGroup, bootstrap } = harness([
      SharedOrdersHandler,
    ]);

    await bootstrap();

    expect({
      subscribe: subscribe.mock.calls.length,
      subscribeGroup: subscribeGroup.mock.calls.length,
    }).toEqual({ subscribe: 1, subscribeGroup: 0 });
  });

  it('subscribes flagged handlers of one group id together', async () => {
    const { subscribeGroup, bootstrap } = harness([
      SharedOrdersHandler,
      SharedRefundsIndexer,
    ]);

    await bootstrap();

    expect(subscribeGroup).toHaveBeenCalledWith('billing', [
      {
        handlerName: 'SharedOrdersHandler.onOrder',
        subscription: expect.objectContaining({
          topicPatterns: ['billing.orders'],
          errorHandling: { type: 'fail' },
        }),
        delivery: { kind: 'message', handle: expect.any(Function) },
      },
      {
        handlerName: 'SharedRefundsIndexer.index',
        subscription: expect.objectContaining({
          topicPatterns: ['billing.refunds'],
          errorHandling: { type: 'dlq' },
        }),
        delivery: { kind: 'batch', handle: expect.any(Function) },
      },
    ]);
  });

  it('subscribes no member of a shared group on its own', async () => {
    const { subscribe, subscribeBatch, bootstrap } = harness([
      SharedOrdersHandler,
      SharedRefundsIndexer,
    ]);

    await bootstrap();

    expect([...subscribe.mock.calls, ...subscribeBatch.mock.calls]).toEqual(
      [],
    );
  });

  it('rejects a group where one member does not set sharedGroup', async () => {
    const { bootstrap } = harness([SharedOrdersHandler, UnflaggedBillingHandler]);

    await expect(bootstrap()).rejects.toThrow(
      'Message handlers SharedOrdersHandler.onOrder and UnflaggedBillingHandler.onInvoice share groupId "billing". Give each handler its own groupId, or set sharedGroup: true on every handler of the group.',
    );
  });

  it('names the unflagged handler when it is listed after two flagged ones', async () => {
    const { bootstrap } = harness([
      SharedOrdersHandler,
      SharedRefundsIndexer,
      UnflaggedBillingHandler,
    ]);

    await expect(bootstrap()).rejects.toThrow(
      /UnflaggedBillingHandler\.onInvoice share groupId "billing"/,
    );
  });

  it('rejects handlers that set sharedGroup to false on one group id', async () => {
    const { bootstrap } = harness([
      ExplicitlyUnsharedInvoices,
      ExplicitlyUnsharedRefunds,
    ]);

    await expect(bootstrap()).rejects.toThrow(/share groupId "unshared"/);
  });

  it('reports a flagged handler provided by two modules as a duplicate registration', async () => {
    const { bootstrap } = harness([], {
      imports: [SharedOrdersModuleA, SharedOrdersModuleB],
    });

    await expect(bootstrap()).rejects.toThrow(
      /SharedOrdersHandler\.onOrder is provided more than once/,
    );
  });

  it('binds a shared route to its provider instance', async () => {
    const { subscribeGroup, bootstrap } = harness([
      SharedOrdersHandler,
      SharedRefundsIndexer,
    ]);

    const app = await bootstrap();
    const [, routes] = subscribeGroup.mock.calls[0];
    await routes[0].delivery.handle(
      { key: null, value: null },
      { topic: 'billing.orders', partition: 0, offset: '0', timestamp: '0' },
    );

    expect(app.get(SharedOrdersHandler).receivers[0]).toBe(
      app.get(SharedOrdersHandler),
    );
  });

  it('releases connections when a shared group fails to subscribe', async () => {
    const { subscribeGroup, releaseConnections, bootstrap } = harness([
      SharedOrdersHandler,
      SharedRefundsIndexer,
    ]);
    subscribeGroup.mockRejectedValue(new Error('group subscribe failed'));

    await expect(bootstrap()).rejects.toThrow('group subscribe failed');
    expect(releaseConnections).toHaveBeenCalledTimes(1);
  });
});
