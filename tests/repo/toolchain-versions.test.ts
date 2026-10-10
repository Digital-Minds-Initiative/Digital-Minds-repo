import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

/*
 * `.nvmrc` is the only place the Node version is set: fnm/nvm and CI read it directly.
 * package.json "engines" and the README cannot read it, so these checks fail until they match.
 * To change Node: edit `.nvmrc`, then update "engines" and the README Prerequisites.
 */

function readRepoFile(path: string): string {
  return readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
}

interface PackageJson {
  packageManager: string;
  engines: { node: string; pnpm: string };
}

const nodeVersion = readRepoFile('.nvmrc').trim();
const pkg = JSON.parse(readRepoFile('package.json')) as PackageJson;
const pnpmVersion = pkg.packageManager.replace(/^pnpm@/, '');

/** `>=X.Y.Z <X+1`: the pinned version or a newer release of the same major. */
function sameMajorRange(version: string): string {
  const major = Number(version.split('.')[0]);
  return `>=${version} <${major + 1}`;
}

function readmeSection(heading: string): string {
  const readme = readRepoFile('README.md');
  const start = readme.indexOf(`\n## ${heading}`);
  if (start === -1) throw new Error(`README has no "## ${heading}" section`);
  const end = readme.indexOf('\n## ', start + 1);
  return readme.slice(start, end === -1 ? undefined : end);
}

describe('toolchain versions', () => {
  it('.nvmrc holds one exact Node version', () => {
    expect(nodeVersion).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('package.json "engines" starts at the pinned Node and pnpm versions', () => {
    expect(pkg.engines.node).toBe(sameMajorRange(nodeVersion));
    expect(pkg.engines.pnpm).toBe(sameMajorRange(pnpmVersion));
  });

  it('the README Prerequisites state the same versions and no others', () => {
    const prerequisites = readmeSection('1. Prerequisites');
    expect(prerequisites).toContain(`**${nodeVersion}**`);
    expect(prerequisites).toContain(`**${pnpmVersion}**`);
    expect(prerequisites).toContain(pkg.engines.node);

    const exactVersions = new Set(prerequisites.match(/\d+\.\d+\.\d+/g));
    expect([...exactVersions].sort()).toEqual([nodeVersion, pnpmVersion].sort());
  });
});
