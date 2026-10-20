export const DEFAULT_SHUTDOWN_TIMEOUT_MS = 10000;

export class DrainingGroups {
  private readonly pending: string[] = [];

  public track<T>(groupId: string, work: Promise<T>): Promise<T> {
    this.pending.push(groupId);

    return work.finally(() => {
      this.pending.splice(this.pending.indexOf(groupId), 1);
    });
  }

  public get groupIds(): string[] {
    return [...new Set(this.pending)];
  }
}

export async function settlesWithin(work: Promise<void>, timeoutMs: number): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<false>((resolve) => {
    timer = setTimeout(() => resolve(false), timeoutMs);
  });

  try {
    return await Promise.race([work.then(() => true), deadline]);
  } finally {
    clearTimeout(timer);
  }
}
