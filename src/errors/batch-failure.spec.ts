import { BatchFailure } from './batch-failure.js';

describe('BatchFailure', () => {
  it('carries the index of the failing message', () => {
    expect(new BatchFailure(2, new Error('boom')).index).toBe(2);
  });

  it('carries the cause of the failure', () => {
    const cause = new Error('boom');

    expect(new BatchFailure(0, cause).cause).toBe(cause);
  });

  it('is named BatchFailure', () => {
    expect(new BatchFailure(0, new Error('boom')).name).toBe('BatchFailure');
  });

  it('describes the index and the cause message', () => {
    expect(new BatchFailure(3, new Error('boom')).message).toBe(
      'Batch message at index 3 failed: boom',
    );
  });

  it('describes a cause that is not an error', () => {
    expect(new BatchFailure(1, 'nope').message).toBe(
      'Batch message at index 1 failed: nope',
    );
  });

  it('rejects a negative index', () => {
    expect(() => new BatchFailure(-1, new Error('boom'))).toThrow(RangeError);
  });

  it('rejects a fractional index', () => {
    expect(() => new BatchFailure(1.5, new Error('boom'))).toThrow(RangeError);
  });

  it('rejects a non-numeric index', () => {
    expect(() => new BatchFailure(Number.NaN, new Error('boom'))).toThrow(
      /non-negative integer/,
    );
  });
});
