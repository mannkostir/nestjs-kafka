export const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export const waitFor = async (
  predicate: () => boolean,
  timeoutMs = 60000,
): Promise<void> => {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (predicate()) {
      return;
    }

    await pause(250);
  }

  throw new Error('Timed out waiting for the expected condition');
};

export const eventually = async (
  assertion: () => Promise<void>,
  timeoutMs = 30000,
): Promise<void> => {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    try {
      return await assertion();
    } catch {
      await pause(250);
    }
  }

  return assertion();
};
