export type BackoffOptions = { initialMs?: number; maxMs?: number; multiplier?: number };

export type MessageErrorHandlingOptions =
    | { type: 'fail'; backoff?: BackoffOptions | false }
    | { type: 'ignore' }
    | { type: 'dlq'; topic?: string }
    | { type: 'retry'; attempts: number; backoff?: BackoffOptions; dlq?: { topic?: string } };
