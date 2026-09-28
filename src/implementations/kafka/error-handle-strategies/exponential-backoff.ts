import type { FailBackoffOptions } from '../../../types/message-error-handling.type.js';

export class ExponentialBackoff {
  public static readonly DEFAULTS = { initialMs: 300, maxMs: 30000, multiplier: 2 } as const;
  private static readonly LONGEST_TIMER_DELAY_MS = 2147483647;

  private constructor(
    private readonly initialMs: number,
    private readonly maxMs: number,
    private readonly multiplier: number,
  ) {}

  public static from(options: FailBackoffOptions): ExponentialBackoff {
    const initialMs = options.initialMs ?? ExponentialBackoff.DEFAULTS.initialMs;
    const maxMs = options.maxMs ?? ExponentialBackoff.DEFAULTS.maxMs;
    const multiplier = options.multiplier ?? ExponentialBackoff.DEFAULTS.multiplier;

    ExponentialBackoff.assertInitialMs(initialMs);
    ExponentialBackoff.assertMaxMs(maxMs, initialMs);
    ExponentialBackoff.assertMultiplier(multiplier);

    return new ExponentialBackoff(initialMs, maxMs, multiplier);
  }

  public delayAfter(attempt: number): number {
    return Math.min(this.initialMs * this.multiplier ** attempt, this.maxMs);
  }

  private static assertInitialMs(initialMs: number): void {
    if (!Number.isFinite(initialMs) || initialMs <= 0) {
      throw ExponentialBackoff.invalid(`"initialMs" (${initialMs}) must be a finite number greater than 0.`);
    }
  }

  private static assertMaxMs(maxMs: number, initialMs: number): void {
    if (!Number.isFinite(maxMs)) {
      throw ExponentialBackoff.invalid(`"maxMs" (${maxMs}) must be a finite number.`);
    }

    if (maxMs > ExponentialBackoff.LONGEST_TIMER_DELAY_MS) {
      throw ExponentialBackoff.invalid(
        `"maxMs" (${maxMs}) must be at most ${ExponentialBackoff.LONGEST_TIMER_DELAY_MS}.`,
      );
    }

    if (maxMs < initialMs) {
      throw ExponentialBackoff.invalid(
        `"maxMs" (${maxMs}) must be greater than or equal to "initialMs" (${initialMs}).`,
      );
    }
  }

  private static assertMultiplier(multiplier: number): void {
    if (!Number.isFinite(multiplier) || multiplier < 1) {
      throw ExponentialBackoff.invalid(
        `"multiplier" (${multiplier}) must be a finite number greater than or equal to 1.`,
      );
    }
  }

  private static invalid(reason: string): Error {
    return new Error(`Invalid fail backoff: ${reason}`);
  }
}
