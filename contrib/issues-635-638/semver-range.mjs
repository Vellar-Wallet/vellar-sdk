// Minimal semver range matcher for the peer ranges this package declares
// (caret, tilde, comparators, space-joined AND, `||` OR). Prerelease versions
// never satisfy a range, matching npm's default behaviour.

const VERSION = /^v?(\d+)\.(\d+)\.(\d+)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

export function parseVersion(input) {
  const m = VERSION.exec(String(input).trim());
  if (!m) return null;
  return { major: +m[1], minor: +m[2], patch: +m[3], prerelease: /-/.test(String(input)) };
}

export function compareVersions(a, b) {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  if (!pa || !pb) throw new Error(`Invalid version: ${!pa ? a : b}`);
  return pa.major - pb.major || pa.minor - pb.minor || pa.patch - pb.patch;
}

function parsePartial(text) {
  const parts = text.replace(/^v/, "").split(".");
  if (parts.length === 0 || parts.length > 3 || parts.some((p) => !/^(\d+|x|\*)$/i.test(p))) {
    throw new Error(`Unsupported range token: ${text}`);
  }
  const nums = parts.map((p) => (/^\d+$/.test(p) ? +p : null));
  return [nums[0] ?? 0, nums[1] ?? 0, nums[2] ?? 0];
}

const fmt = ([a, b, c]) => `${a}.${b}.${c}`;

function comparator(token) {
  const m = /^(\^|~|>=|<=|>|<|=)?(.+)$/.exec(token);
  if (!m) throw new Error(`Unsupported range token: ${token}`);
  const [, op = "=", rest] = m;
  const v = parsePartial(rest);
  const [maj, min, pat] = v;
  switch (op) {
    case "^": {
      const upper = maj > 0 ? [maj + 1, 0, 0] : min > 0 ? [0, min + 1, 0] : [0, 0, pat + 1];
      return (x) => compareVersions(x, fmt(v)) >= 0 && compareVersions(x, fmt(upper)) < 0;
    }
    case "~":
      return (x) => compareVersions(x, fmt(v)) >= 0 && compareVersions(x, fmt([maj, min + 1, 0])) < 0;
    case ">=":
      return (x) => compareVersions(x, fmt(v)) >= 0;
    case ">":
      return (x) => compareVersions(x, fmt(v)) > 0;
    case "<=":
      return (x) => compareVersions(x, fmt(v)) <= 0;
    case "<":
      return (x) => compareVersions(x, fmt(v)) < 0;
    default:
      return (x) => compareVersions(x, fmt(v)) === 0;
  }
}

export function satisfies(version, range) {
  const parsed = parseVersion(version);
  if (!parsed || parsed.prerelease) return false;
  return range.split("||").some((clause) =>
    clause
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .map(comparator)
      .every((test) => test(version)),
  );
}

/** Lowest and highest published version that satisfies `range`. */
export function pickBounds(versions, range) {
  const matching = versions.filter((v) => satisfies(v, range)).sort(compareVersions);
  if (matching.length === 0) return null;
  return { floor: matching[0], latest: matching[matching.length - 1] };
}
