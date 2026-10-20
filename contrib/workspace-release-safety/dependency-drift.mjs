import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const DEPENDENCY_SECTIONS = [
  "dependencies",
  "peerDependencies",
  "optionalDependencies",
  "devDependencies",
];

function parseVersion(input) {
  const match = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/.exec(input);
  if (!match) {
    throw new Error(`Unsupported semantic version: ${input}`);
  }

  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] ?? null,
    raw: input,
  };
}

function compareVersions(left, right) {
  for (const key of ["major", "minor", "patch"]) {
    if (left[key] !== right[key]) return left[key] < right[key] ? -1 : 1;
  }
  if (left.prerelease === right.prerelease) return 0;
  if (left.prerelease === null) return 1;
  if (right.prerelease === null) return -1;
  return left.prerelease.localeCompare(right.prerelease);
}

function upperBoundForCaret(version) {
  if (version.major > 0) return { ...version, major: version.major + 1, minor: 0, patch: 0 };
  if (version.minor > 0) return { ...version, minor: version.minor + 1, patch: 0 };
  return { ...version, patch: version.patch + 1 };
}

function testComparator(version, comparator) {
  const match = /^(<=|>=|<|>|=|\^|~)?\s*(\d+)(?:\.(\d+|x|X|\*))?(?:\.(\d+|x|X|\*))?$/.exec(
    comparator,
  );
  if (!match) throw new Error(`Unsupported semantic-version comparator: ${comparator}`);

  const operator = match[1] ?? "=";
  const major = Number(match[2]);
  const minorToken = match[3];
  const patchToken = match[4];
  const wildcardMinor = minorToken === undefined || /^(x|\*)$/i.test(minorToken);
  const wildcardPatch = patchToken === undefined || /^(x|\*)$/i.test(patchToken);

  if (wildcardMinor) return version.major === major;
  const minor = Number(minorToken);
  if (wildcardPatch && operator === "=") {
    return version.major === major && version.minor === minor;
  }

  const target = {
    major,
    minor,
    patch: wildcardPatch ? 0 : Number(patchToken),
    prerelease: null,
  };
  const comparison = compareVersions(version, target);

  if (operator === "^") {
    return comparison >= 0 && compareVersions(version, upperBoundForCaret(target)) < 0;
  }
  if (operator === "~") {
    const upper = { ...target, minor: target.minor + 1, patch: 0 };
    return comparison >= 0 && compareVersions(version, upper) < 0;
  }
  if (operator === ">=") return comparison >= 0;
  if (operator === "<=") return comparison <= 0;
  if (operator === ">") return comparison > 0;
  if (operator === "<") return comparison < 0;
  return comparison === 0;
}

export function satisfiesRange(versionInput, rangeInput) {
  const version = parseVersion(versionInput);
  const range = rangeInput.trim();
  if (range === "" || range === "*" || /^latest$/i.test(range)) return true;
  if (/^(workspace:|file:|link:|git\+|https?:)/.test(range)) {
    throw new Error(`Non-semver dependency range is not supported: ${range}`);
  }

  return range.split("||").some((branch) => {
    const trimmed = branch.trim();
    const hyphen = /^(\d+\.\d+\.\d+)\s+-\s+(\d+\.\d+\.\d+)$/.exec(trimmed);
    if (hyphen) {
      const lower = parseVersion(hyphen[1]);
      const upper = parseVersion(hyphen[2]);
      return compareVersions(version, lower) >= 0 && compareVersions(version, upper) <= 0;
    }

    const comparators = trimmed.split(/\s+/).filter(Boolean);
    return comparators.every((comparator) => testComparator(version, comparator));
  });
}

function declaredMinimum(range) {
  const candidates = [...range.matchAll(/(?:^|\||\s)(?:\^|~|>=|>|=)?\s*(\d+\.\d+\.\d+)/g)].map(
    (match) => parseVersion(match[1]),
  );
  if (candidates.length === 0) return null;
  return candidates.reduce((minimum, candidate) =>
    compareVersions(candidate, minimum) < 0 ? candidate : minimum,
  );
}

function findDependency(manifest, dependencyName) {
  const declarations = DEPENDENCY_SECTIONS.flatMap((section) => {
    const range = manifest[section]?.[dependencyName];
    return typeof range === "string" ? [{ section, range }] : [];
  });
  if (declarations.length > 1) {
    throw new Error(`${manifest.name} declares ${dependencyName} in multiple dependency sections`);
  }
  return declarations[0] ?? null;
}

export function auditDependencyDrift({
  rootManifest,
  workspaceManifests,
  strictMinimum = true,
}) {
  if (!rootManifest.name || !rootManifest.version) {
    throw new Error("Root package must declare name and version");
  }

  return workspaceManifests.flatMap((manifest) => {
    const dependency = findDependency(manifest, rootManifest.name);
    if (!dependency) return [];

    const compatible = satisfiesRange(rootManifest.version, dependency.range);
    const minimum = declaredMinimum(dependency.range);
    const staleMinimum = minimum
      ? compareVersions(minimum, parseVersion(rootManifest.version)) < 0
      : false;
    const status = !compatible ? "incompatible" : staleMinimum ? "stale-minimum" : "aligned";

    return [{
      packageName: manifest.name,
      dependencySection: dependency.section,
      range: dependency.range,
      rootVersion: rootManifest.version,
      compatible,
      staleMinimum,
      status,
      fails: !compatible || (strictMinimum && staleMinimum),
    }];
  });
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

export async function loadWorkspaceManifests(rootDirectory) {
  const rootManifest = await readJson(path.join(rootDirectory, "package.json"));
  const patterns = rootManifest.workspaces ?? [];
  const manifests = [];

  for (const pattern of patterns) {
    if (!pattern.endsWith("/*")) {
      throw new Error(`Only one-level workspace globs are supported by this check: ${pattern}`);
    }
    const parent = path.join(rootDirectory, pattern.slice(0, -2));
    for (const entry of await readdir(parent, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const manifestPath = path.join(parent, entry.name, "package.json");
      try {
        manifests.push(await readJson(manifestPath));
      } catch (error) {
        if (error?.code !== "ENOENT") throw error;
      }
    }
  }

  return { rootManifest, workspaceManifests: manifests };
}

async function main() {
  const rootDirectory = path.resolve(process.argv[2] ?? ".");
  const loaded = await loadWorkspaceManifests(rootDirectory);
  const results = auditDependencyDrift(loaded);
  const failures = results.filter((result) => result.fails);

  for (const result of results) {
    const marker = result.fails ? "ERROR" : "OK";
    console.log(
      `[${marker}] ${result.packageName}: ${loaded.rootManifest.name}@${result.range} ` +
        `against ${result.rootVersion} (${result.status})`,
    );
  }

  if (failures.length > 0) process.exitCode = 1;
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
