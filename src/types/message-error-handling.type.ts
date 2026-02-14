export type MessageErrorHandlingConfig =
    | { type: 'fail' }
    | { type: 'ignore' }
    | { type: 'dlq'; topic?: string };
