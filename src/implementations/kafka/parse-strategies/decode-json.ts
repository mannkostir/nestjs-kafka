export function decodeJson(raw: Buffer | string, part: 'value' | 'payload'): unknown {
    const text = Buffer.isBuffer(raw) ? raw.toString('utf8') : raw;

    try {
        return JSON.parse(text);
    } catch (error) {
        throw new Error(
            `Failed to parse message ${part} as JSON: ${(error as Error).message}`,
        );
    }
}
