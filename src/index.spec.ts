import * as publicApi from './index.js';

describe('package entry point', () => {
  it('does not expose the consumer proxy', () => {
    expect(publicApi).not.toHaveProperty('ConsumerProxy');
  });

  it('exposes the producer proxy', () => {
    expect(publicApi).toHaveProperty('ProducerProxy');
  });
});
