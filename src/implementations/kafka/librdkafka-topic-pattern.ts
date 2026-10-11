export class LibrdkafkaTopicPattern {
  public static validate(pattern: string | RegExp): void {
    if (typeof pattern === 'string') {
      LibrdkafkaTopicPattern.validateTopicName(pattern);
      return;
    }

    const problem = LibrdkafkaTopicPattern.findProblem(pattern);

    if (problem) {
      throw new Error(
        `Topic pattern ${pattern} cannot be subscribed: ${problem}. ` +
        'Topic patterns are matched by librdkafka as POSIX extended regular expressions: ' +
        'they carry no flags and use only plain (...) groups, |, bracket expressions and greedy quantifiers.',
      );
    }
  }

  public static anchor(pattern: string | RegExp): string | RegExp {
    if (typeof pattern === 'string' || pattern.source.startsWith('^')) {
      return pattern;
    }

    return new RegExp(`^.*(${pattern.source})`);
  }

  private static validateTopicName(topic: string): void {
    if (topic.startsWith('^')) {
      throw new Error(
        `Topic "${topic}" cannot be subscribed: librdkafka matches a topic starting with ^ as a regular expression. ` +
        `Pass a RegExp instead, for example /${topic}/.`,
      );
    }
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

  private static readonly POSIX_CLASSES: ReadonlyMap<string, string> = new Map([
    ['alnum', 'A-Za-z0-9'],
    ['alpha', 'A-Za-z'],
    ['blank', ' \\t'],
    ['cntrl', '\\x00-\\x1f\\x7f'],
    ['digit', '0-9'],
    ['graph', '!-~'],
    ['lower', 'a-z'],
    ['print', ' -~'],
    ['punct', '!-\\/:-@\\[-`{-~'],
    ['space', ' \\t\\n\\r\\f\\v'],
    ['upper', 'A-Z'],
    ['xdigit', '0-9A-Fa-f'],
  ]);

  public static matcher(pattern: RegExp): RegExp {
    return new RegExp(LibrdkafkaTopicPattern.toJavaScript(pattern));
  }

  private static toJavaScript(pattern: RegExp): string {
    const source = pattern.source;
    let translated = '';
    let index = 0;

    while (index < source.length) {
      const char = source[index];

      if (char === '\\') {
        translated += source.slice(index, index + 2);
        index += 2;
      } else if (char === '[') {
        const bracket = LibrdkafkaTopicPattern.translateBracket(pattern, index);
        translated += bracket.translated;
        index = bracket.end;
      } else {
        translated += char;
        index++;
      }
    }

    return translated;
  }

  private static translateBracket(pattern: RegExp, start: number): { translated: string; end: number } {
    const source = pattern.source;
    let index = start + 1;
    let translated = '[';

    if (source[index] === '^') {
      translated += '^';
      index++;
    }

    if (source[index] === ']') {
      translated += '\\]';
      index++;
    }

    while (index < source.length && source[index] !== ']') {
      if (source.startsWith('[:', index)) {
        const close = source.indexOf(':]', index + 2);

        if (close === -1) {
          throw LibrdkafkaTopicPattern.unterminated(pattern);
        }

        translated += LibrdkafkaTopicPattern.posixClass(pattern, source.slice(index + 2, close));
        index = close + 2;
      } else if (source.startsWith('[.', index) || source.startsWith('[=', index)) {
        throw new Error(
          `Topic pattern ${pattern} cannot be routed in a shared group: collating elements and equivalence classes are not supported. ` +
          'Spell the characters out in the bracket expression.',
        );
      } else {
        translated += source[index] === '\\' ? '\\\\' : source[index];
        index++;
      }
    }

    if (index >= source.length) {
      throw LibrdkafkaTopicPattern.unterminated(pattern);
    }

    return { translated: `${translated}]`, end: index + 1 };
  }

  private static posixClass(pattern: RegExp, name: string): string {
    const range = LibrdkafkaTopicPattern.POSIX_CLASSES.get(name);

    if (range === undefined) {
      throw new Error(`Topic pattern ${pattern} uses [:${name}:], which is not a POSIX character class.`);
    }

    return range;
  }

  private static unterminated(pattern: RegExp): Error {
    return new Error(`Topic pattern ${pattern} has an unterminated bracket expression.`);
  }
}
