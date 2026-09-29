import { ResolvedConsumerConfig } from './resolved-consumer-config.js';

describe('ResolvedConsumerConfig', () => {
  it('applies built-in defaults when nothing is configured', () => {
    const config = ResolvedConsumerConfig.resolve();

    expect(config.clientConfig('group')).toEqual({
      groupId: 'group',
      fromBeginning: false,
      allowAutoTopicCreation: true,
      retry: {},
    });
  });

  it('omits unset fields from the client config', () => {
    const config = ResolvedConsumerConfig.resolve({ sessionTimeout: 45000 });

    expect(Object.keys(config.clientConfig('group'))).toEqual([
      'groupId',
      'fromBeginning',
      'allowAutoTopicCreation',
      'sessionTimeout',
      'retry',
    ]);
  });

  it('lets module defaults beat built-in defaults', () => {
    const config = ResolvedConsumerConfig.resolve(undefined, {
      fromBeginning: true,
      allowAutoTopicCreation: false,
      heartbeatInterval: 3000,
      sessionTimeout: 45000,
      rebalanceTimeout: 60000,
    });

    expect(config.clientConfig('group')).toEqual({
      groupId: 'group',
      fromBeginning: true,
      allowAutoTopicCreation: false,
      heartbeatInterval: 3000,
      sessionTimeout: 45000,
      rebalanceTimeout: 60000,
      retry: {},
    });
  });

  it('lets handler overrides beat module defaults', () => {
    const config = ResolvedConsumerConfig.resolve(
      {
        fromBeginning: false,
        allowAutoTopicCreation: true,
        heartbeatInterval: 1000,
        sessionTimeout: 10000,
        rebalanceTimeout: 20000,
      },
      {
        fromBeginning: true,
        allowAutoTopicCreation: false,
        heartbeatInterval: 3000,
        sessionTimeout: 45000,
        rebalanceTimeout: 60000,
      },
    );

    expect(config.clientConfig('group')).toEqual({
      groupId: 'group',
      fromBeginning: false,
      allowAutoTopicCreation: true,
      heartbeatInterval: 1000,
      sessionTimeout: 10000,
      rebalanceTimeout: 20000,
      retry: {},
    });
  });

  it('exposes the resolved fromBeginning and allowAutoTopicCreation', () => {
    const config = ResolvedConsumerConfig.resolve(
      { fromBeginning: true },
      { allowAutoTopicCreation: false },
    );

    expect([config.fromBeginning, config.allowAutoTopicCreation]).toEqual([true, false]);
  });

  it('merges retry shallowly with handler fields winning', () => {
    const config = ResolvedConsumerConfig.resolve(
      { retry: { retries: 2 } },
      { retry: { retries: 5, initialRetryTime: 100 } },
    );

    expect(config.clientConfig('group').retry).toEqual({
      retries: 2,
      initialRetryTime: 100,
    });
  });

  it('computes the join timeout from the default rebalance and session timeouts', () => {
    const config = ResolvedConsumerConfig.resolve();

    expect(config.joinTimeoutMs()).toBe(330000);
  });

  it('computes the join timeout from the configured rebalance and session timeouts', () => {
    const config = ResolvedConsumerConfig.resolve(
      { rebalanceTimeout: 20000 },
      { sessionTimeout: 45000 },
    );

    expect(config.joinTimeoutMs()).toBe(65000);
  });
});
