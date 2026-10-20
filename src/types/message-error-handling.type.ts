export type FailBackoffOptions = { initialMs?: number; maxMs?: number; multiplier?: number };

export type MessageErrorHandlingOptions =
    | { type: 'fail'; backoff?: FailBackoffOptions | false }
    | { type: 'ignore' }
    | { type: 'dlq'; topic?: string }
    | { type: 'retry'; attempts: number; backoff?: FailBackoffOptions; dlqTopic?: string };
