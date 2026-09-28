export type FailBackoffOptions = { initialMs?: number; maxMs?: number; multiplier?: number };

export type MessageErrorHandlingConfig =
    | { type: 'fail'; backoff?: FailBackoffOptions | false }
    | { type: 'ignore' }
    | { type: 'dlq'; topic?: string };
