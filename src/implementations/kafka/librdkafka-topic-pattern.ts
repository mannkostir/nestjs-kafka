export class LibrdkafkaTopicPattern {
  public static normalize(pattern: string | RegExp): string | RegExp {
    if (typeof pattern === 'string') {
      return pattern;
    }

    const problem = LibrdkafkaTopicPattern.findProblem(pattern);

    if (problem) {
      throw new Error(
        `Topic pattern ${pattern} cannot be subscribed: ${problem}. ` +
        'Topic patterns are matched by librdkafka as POSIX extended regular expressions: ' +
        'they carry no flags and use only plain (...) groups, |, bracket expressions and greedy quantifiers.',
      );
    }

    return pattern.source.startsWith('^')
      ? pattern
      : new RegExp(`^.*(${pattern.source})`);
  }

  private static findProblem(pattern: RegExp): string | undefined {
    if (pattern.flags) {
      return `flags "${pattern.flags}" are not supported; remove them and spell variants out, for example [Oo]rders`;
    }

    return LibrdkafkaTopicPattern.findUnsupportedSyntax(pattern.source);
  }

  private static findUnsupportedSyntax(source: string): string | undefined {
    let inBracket = false;

    for (let index = 0; index < source.length; index++) {
      const char = source[index];
      const next = source[index + 1];

      if (char === '\\') {
        if (next !== undefined && /[A-Za-z0-9]/.test(next)) {
          return `escape \\${next} is not portable; use a bracket expression such as [0-9] or [[:alnum:]_]`;
        }
        index++;
        continue;
      }

      if (inBracket) {
        inBracket = char !== ']';
        continue;
      }

      if (char === '[') {
        inBracket = true;
        continue;
      }

      if (char === '(' && next === '?') {
        return 'groups starting with (? (non-capturing, lookaround, inline flags) are not supported; use a plain (...) group';
      }

      if ('*+?}'.includes(char) && next === '?') {
        return 'lazy quantifiers are not supported; use the greedy form';
      }
    }

    return undefined;
  }
}
