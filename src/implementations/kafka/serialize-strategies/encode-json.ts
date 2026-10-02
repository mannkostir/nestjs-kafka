export function encodeJson(value: unknown): string {
  const text = JSON.stringify(value);

  if (text === undefined) {
    throw new Error(
      `Message value of type ${typeof value} cannot be encoded as JSON. ` +
      'Send null for a record without a value.',
    );
  }

  return text;
}
