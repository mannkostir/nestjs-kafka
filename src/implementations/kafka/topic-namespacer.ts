export class TopicNamespacer {
  constructor(private readonly namespace?: string) {}

  public apply(topic: string): string {
    return this.namespace ? `${this.namespace}.${topic}` : topic;
  }

  public applyPattern(pattern: string | RegExp): string | RegExp {
    if (!this.namespace) {
      return pattern;
    }

    if (typeof pattern === 'string') {
      return this.apply(pattern);
    }

    const prefix = `${TopicNamespacer.escape(this.namespace)}\\.`;
    const source = pattern.source.startsWith('^')
      ? `^${prefix}(?:${pattern.source.slice(1)})`
      : `^${prefix}.*(?:${pattern.source})`;

    return new RegExp(source, pattern.flags);
  }

  private static escape(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
}
