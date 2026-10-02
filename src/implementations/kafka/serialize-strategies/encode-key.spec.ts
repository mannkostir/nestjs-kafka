import { encodeKey } from './encode-key.js';

describe('encodeKey', () => {
  it('keeps a string key unchanged', () => {
    expect(encodeKey('order-1')).toBe('order-1');
  });

  it('keeps a null key as a record without a key', () => {
    expect(encodeKey(null)).toBeNull();
  });

  it('encodes an object key as JSON', () => {
    expect(encodeKey({ tenant: 'acme' })).toBe('{"tenant":"acme"}');
  });
});
