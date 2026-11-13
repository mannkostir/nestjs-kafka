const identifier = '(?:0|[1-9][0-9]*|[0-9]*[A-Za-z-][0-9A-Za-z-]*)';
const versionPattern = new RegExp(
  `^(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)(?:-(${identifier}(?:\\.${identifier})*))?(?:\\+[0-9A-Za-z-]+(?:\\.[0-9A-Za-z-]+)*)?$`,
);

function parseVersion(version) {
  const match = typeof version === 'string' && versionPattern.exec(version);
  if (!match) {
    throw new RangeError(`Invalid SemVer version: ${version}`);
  }
  return {
    core: match.slice(1, 4).map(BigInt),
    prerelease: match[4] ? match[4].split('.') : [],
  };
}

function isStableNewer(release, latest) {
  for (let index = 0; index < release.core.length; index++) {
    if (release.core[index] !== latest.core[index]) {
      return release.core[index] > latest.core[index];
    }
  }
  return latest.prerelease.length > 0;
}

function selectDistTag(version, latestVersion) {
  const release = parseVersion(version);
  if (release.prerelease.length > 0) return 'next';
  if (latestVersion === '') return 'latest';
  const latest = parseVersion(latestVersion);
  return isStableNewer(release, latest) ? 'latest' : `v${release.core[0]}-lts`;
}

module.exports = { selectDistTag };

if (require.main === module) {
  process.stdout.write(`${selectDistTag(process.argv[2], process.argv[3])}\n`);
}
