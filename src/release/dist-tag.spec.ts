import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const workflow = readFileSync(resolve('.github/workflows/publish.yml'), 'utf8');
const guard = workflow.split('        run: |\n')[1].split('\n  ci:')[0].replace(/^          /gm, '');
const stage = workflow.split('        run: |\n')[2].replace(/^          /gm, '');

function runWorkflow(script: string, latest: string, registryStatus = 0, distTag = '', version = '0.6.0') {
  const directory = mkdtempSync(join(tmpdir(), 'publish-tag-'));
  const output = join(directory, 'output');
  writeFileSync(output, '');
  writeFileSync(join(directory, 'package.json'), JSON.stringify({ name: 'publish-test-package', version }));
  mkdirSync(join(directory, 'scripts'));
  writeFileSync(join(directory, 'scripts/select-dist-tag.js'), readFileSync(resolve('scripts/select-dist-tag.js')));
  writeFileSync(join(directory, 'git'), '#!/bin/bash\nexit 0\n', { mode: 0o755 });
  writeFileSync(join(directory, 'npm'), `#!/bin/bash
if [ "$1" = stage ]; then
  printf '%s\\n' "$@" > "$GITHUB_OUTPUT"
elif [[ "$2" == *@* ]]; then
  echo E404 >&2
  exit 1
else
  printf '%s' "$MOCK_LATEST"
  if [ "$MOCK_REGISTRY_STATUS" = 44 ]; then echo E404 >&2; exit 1; fi
  exit "$MOCK_REGISTRY_STATUS"
fi
`, { mode: 0o755 });
  try {
    const result = spawnSync('bash', ['-c', script], {
      cwd: directory,
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${directory}:${process.env.PATH}`,
        TAG: `v${version}`,
        PRERELEASE: String(version.split('+')[0].includes('-')),
        RUNNER_TEMP: directory,
        GITHUB_OUTPUT: output,
        DIST_TAG: distTag,
        MOCK_LATEST: latest,
        MOCK_REGISTRY_STATUS: String(registryStatus),
      },
    });
    return { status: result.status, output: readFileSync(output, 'utf8'), stdout: result.stdout, stderr: result.stderr };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

describe('publish workflow', () => {
  it('uses a controlled package version aligned with its release tag', () => {
    const result = runWorkflow(guard, '1.0.0', 0, '', '7.4.1');

    expect(result.output).toBe('dist-tag=latest\n');
  });

  it('keeps an older major off latest', () => {
    const result = runWorkflow(guard, '1.0.0');

    expect(result.output).toBe('dist-tag=v0-lts\n');
  });

  it.each(['0.5.0', ''])('uses latest when npm reports %p', (latest) => {
    const result = runWorkflow(guard, latest);

    expect(result.output).toBe('dist-tag=latest\n');
  });

  it('uses latest when the package is not yet in the registry', () => {
    const result = runWorkflow(guard, '', 44);

    expect(result.output).toBe('dist-tag=latest\n');
  });

  it('keeps prereleases on next without querying latest', () => {
    const result = runWorkflow(guard, '', 1, '', '7.4.1-rc.1');

    expect(result.output).toBe('dist-tag=next\n');
  });

  it('rejects malformed registry versions', () => {
    const result = runWorkflow(guard, 'invalid');

    expect(result).toMatchObject({
      status: 1,
      output: '',
      stderr: expect.stringContaining('Invalid SemVer version: invalid'),
    });
  });

  it('fails closed when the latest lookup has a transport error', () => {
    const result = runWorkflow(guard, '', 1);

    expect(result).toMatchObject({
      status: 1,
      output: '',
      stdout: expect.stringContaining('Could not check the latest version of publish-test-package.'),
    });
  });

  it.each(['latest', 'next', 'v0-lts', 'v1-lts'])('passes %s to staged publish', (distTag) => {
    const result = runWorkflow(stage, '', 0, distTag);

    expect(result.output.trim().split('\n')).toEqual([
      'stage', 'publish', '--ignore-scripts', '--loglevel', 'verbose', '--tag', distTag,
    ]);
  });
});

const { selectDistTag } = require('../../scripts/select-dist-tag.js') as {
  selectDistTag: (version: string, latestVersion: string) => string;
};

describe('selectDistTag', () => {
  it.each([
    ['0.9.9', '1.0.0', 'v0-lts'],
    ['1.2.4', '1.3.0', 'v1-lts'],
    ['1.2.2', '1.2.3', 'v1-lts'],
    ['1.2.3', '1.2.3', 'v1-lts'],
    ['1.2.3+new', '1.2.3+old', 'v1-lts'],
    ['1.2.4', '1.2.3', 'latest'],
    ['1.10.0', '1.9.9', 'latest'],
    ['10.0.0', '9.99.99', 'latest'],
    ['1.0.10', '1.0.9', 'latest'],
    ['1.0.0', '1.0.0-rc.10', 'latest'],
    ['1.0.0', '2.0.0-alpha', 'v1-lts'],
    ['1.0.0', '', 'latest'],
    ['2.0.0-rc.1', '1.0.0', 'next'],
    ['0.5.1-beta.2+build', '1.0.0', 'next'],
    ['99999999999999999999.0.0', '99999999999999999998.0.0', 'latest'],
  ])('selects %s against %s as %s', (version, latest, expected) => {
    const result = selectDistTag(version, latest);

    expect(result).toBe(expected);
  });

  it.each(['v1.0.0', '1.0', '01.0.0', '1.0.0-01', 'garbage', '1.0.0\n'])('rejects invalid latest %p', (latest) => {
    expect(() => selectDistTag('1.0.0', latest)).toThrow(RangeError);
  });

  it.each(['', '01.0.0', '1.0.0-01', 'invalid'])('rejects invalid release %p', (version) => {
    expect(() => selectDistTag(version, '1.0.0')).toThrow(RangeError);
  });
});
