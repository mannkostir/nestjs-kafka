const errorHandlingTypes: readonly unknown[] = ['fail', 'ignore', 'dlq'];

const errorHandlingFix =
  "Set errorHandling to { type: 'fail' }, { type: 'ignore' } or { type: 'dlq' }.";

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const isTopicPattern = (entry: unknown): boolean =>
  entry instanceof RegExp || (typeof entry === 'string' && entry.length > 0);

export function describeHandler(
  target: object,
  propertyKey: string | symbol,
): string {
  const className =
    typeof target === 'function' ? target.name : target.constructor.name;
  return `@Message handler ${className}.${String(propertyKey)}`;
}

export function assertValidMessageArguments(
  handler: string,
  topicPatterns: unknown,
  options: unknown,
): void {
  if (!isObject(options)) {
    throw new Error(
      `${handler} has no options. Pass an options object with groupId and errorHandling as the second argument of @Message.`,
    );
  }
  assertGroupId(handler, options.groupId);
  assertErrorHandling(handler, options.errorHandling);
  assertTopicPatterns(handler, topicPatterns);
}

function assertGroupId(handler: string, groupId: unknown): void {
  if (typeof groupId !== 'string' || groupId.length === 0) {
    throw new Error(
      `${handler} needs a "groupId" option that is a non-empty string. Set groupId to the name of the handler's consumer group.`,
    );
  }
}

function assertErrorHandling(handler: string, errorHandling: unknown): void {
  if (!isObject(errorHandling)) {
    throw new Error(
      `${handler} has no "errorHandling" option. ${errorHandlingFix}`,
    );
  }
  if (!errorHandlingTypes.includes(errorHandling.type)) {
    throw new Error(
      `${handler} has an invalid "errorHandling.type" option: ${String(errorHandling.type)}. ${errorHandlingFix}`,
    );
  }
}

function assertTopicPatterns(handler: string, topicPatterns: unknown): void {
  const entries = Array.isArray(topicPatterns) ? topicPatterns : [topicPatterns];
  if (!entries.some(isTopicPattern)) {
    throw new Error(
      `${handler} has no topic. Pass at least one non-empty topic name or RegExp pattern as the first argument of @Message.`,
    );
  }
}
