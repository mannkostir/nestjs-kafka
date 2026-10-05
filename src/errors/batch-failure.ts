export class BatchFailure extends Error {
  public override readonly name = 'BatchFailure';

  constructor(
    readonly index: number,
    readonly cause: unknown,
  ) {
    super(`Batch message at index ${BatchFailure.validIndex(index)} failed: ${BatchFailure.describe(cause)}`);
  }

  private static validIndex(index: number): number {
    if (!Number.isInteger(index) || index < 0) {
      throw new RangeError(
        `BatchFailure index must be a non-negative integer, got ${index}. Pass the position of the failing message in the batch the handler received.`,
      );
    }

    return index;
  }

  private static describe(cause: unknown): string {
    return cause instanceof Error ? cause.message : String(cause);
  }
}
