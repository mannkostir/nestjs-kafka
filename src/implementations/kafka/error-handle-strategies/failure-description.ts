export type FailureDescription = { name: string; message: string; stack?: string };

export const describeFailure = (error: unknown): FailureDescription => {
  if (error instanceof Error) {
    return {
      name: error.name || 'Error',
      message: error.message || 'Unknown error',
      stack: error.stack,
    };
  }

  return { name: 'Error', message: String(error) };
};
