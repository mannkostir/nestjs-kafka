import { ExponentialBackoff } from './exponential-backoff.js';

describe('ExponentialBackoff', () => {
  it('waits initialMs before the first redelivery', () => {
    const backoff = ExponentialBackoff.from({});

    expect(backoff.delayAfter(0)).toBe(300);
  });

  it('doubles the delay by default on the second attempt', () => {
    const backoff = ExponentialBackoff.from({});

    expect(backoff.delayAfter(1)).toBe(600);
  });

  it('keeps growing the delay on the third attempt', () => {
    const backoff = ExponentialBackoff.from({});

    expect(backoff.delayAfter(2)).toBe(1200);
  });

  it('caps the delay at maxMs', () => {
    const backoff = ExponentialBackoff.from({ initialMs: 1000, maxMs: 5000 });

    expect(backoff.delayAfter(10)).toBe(5000);
  });

  it('stays at maxMs for an attempt large enough to overflow', () => {
    const backoff = ExponentialBackoff.from({});

    expect(backoff.delayAfter(100000)).toBe(30000);
  });

  it('applies a custom multiplier', () => {
    const backoff = ExponentialBackoff.from({ initialMs: 100, multiplier: 3 });

    expect(backoff.delayAfter(2)).toBe(900);
  });

  it('keeps a constant delay with a multiplier of 1', () => {
    const backoff = ExponentialBackoff.from({ initialMs: 250, multiplier: 1 });

    expect(backoff.delayAfter(5)).toBe(250);
  });

  it('fills the default maxMs when only initialMs is given', () => {
    const backoff = ExponentialBackoff.from({ initialMs: 20000 });

    expect(backoff.delayAfter(1)).toBe(30000);
  });

  it('fills the default initialMs when only maxMs is given', () => {
    const backoff = ExponentialBackoff.from({ maxMs: 100000 });

    expect(backoff.delayAfter(0)).toBe(300);
  });

  it('rejects an initialMs of zero', () => {
    expect(() => ExponentialBackoff.from({ initialMs: 0 })).toThrow(
      'Invalid fail backoff: "initialMs" (0) must be a finite number greater than 0.',
    );
  });

  it('rejects a non-finite initialMs', () => {
    expect(() => ExponentialBackoff.from({ initialMs: Number.NaN })).toThrow(
      'Invalid fail backoff: "initialMs" (NaN) must be a finite number greater than 0.',
    );
  });

  it('rejects a maxMs below initialMs', () => {
    expect(() => ExponentialBackoff.from({ maxMs: 100 })).toThrow(
      'Invalid fail backoff: "maxMs" (100) must be greater than or equal to "initialMs" (300).',
    );
  });

  it('rejects an infinite maxMs', () => {
    expect(() => ExponentialBackoff.from({ maxMs: Number.POSITIVE_INFINITY })).toThrow(
      'Invalid fail backoff: "maxMs" (Infinity) must be a finite number.',
    );
  });

  it('accepts the longest delay a timer can hold as maxMs', () => {
    const backoff = ExponentialBackoff.from({ maxMs: 2147483647 });

    expect(backoff.delayAfter(100000)).toBe(2147483647);
  });

  it('rejects a maxMs longer than a timer can hold', () => {
    expect(() => ExponentialBackoff.from({ maxMs: 2147483648 })).toThrow(
      'Invalid fail backoff: "maxMs" (2147483648) must be at most 2147483647.',
    );
  });

  it('rejects a multiplier below 1', () => {
    expect(() => ExponentialBackoff.from({ multiplier: 0.5 })).toThrow(
      'Invalid fail backoff: "multiplier" (0.5) must be a finite number greater than or equal to 1.',
    );
  });

  it('rejects a non-finite multiplier', () => {
    expect(() => ExponentialBackoff.from({ multiplier: Number.POSITIVE_INFINITY })).toThrow(
      'Invalid fail backoff: "multiplier" (Infinity) must be a finite number greater than or equal to 1.',
    );
  });
});
