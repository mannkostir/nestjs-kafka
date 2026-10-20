export const MessageFormat = {
    JSON: 'json',
    ENVELOPED_JSON: 'enveloped-json',
    AVRO: 'avro',
} as const;

export type MessageFormat = (typeof MessageFormat)[keyof typeof MessageFormat];
