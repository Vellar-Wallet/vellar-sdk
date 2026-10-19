// Issue #641 — notice when passkey-kit publishes a release outside the range
// this SDK declares as a peer dependency.
//
// A release inside the declared range (any patch under a caret, say) is
// expected and produces no output. A release outside it means `npm install`
// will not pick it up, so someone has to decide whether to widen the range.
// That decision gets one tracking issue, updated in place if a still newer
// release lands, never a new issue per release.

export class ReleaseWatchError extends Error {
  constructor(message) {
    super(message);
    this.name = "ReleaseWatchError";
  }
}

const EXACT = /^(\d+)\.(\d+)\.(\d+)$/;
const REGISTRY_LATEST = "https://registry.npmjs.org/passkey-kit/latest";

export function parseVersion(text) {
  const m = String(text).trim().match(EXACT);
  if (!m) throw new ReleaseWatchError(`Not an exact x.y.z version: "${text}".`);
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

function compare(a, b) {
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1;
  return 0;
}

function parsePartial(text, range) {
  const m = text.match(/^(\d+)(?:\.(\d+))?(?:\.(\d+))?$/);
  if (!m) throw new ReleaseWatchError(`Cannot read version range "${range}" (at "${text}").`);
  return [Number(m[1]), Number(m[2] ?? 0), Number(m[3] ?? 0)];
}

function comparator(token, range) {
  const m = token.match(/^(\^|~|>=|<=|>|<|=)?(.+)$/);
  const op = m?.[1] ?? "=";
  const v = parsePartial(m?.[2] ?? "", range);
  switch (op) {
    case "^": {
      const upper = v[0] > 0 ? [v[0] + 1, 0, 0] : v[1] > 0 ? [0, v[1] + 1, 0] : [0, 0, v[2] + 1];
      return (x) => compare(x, v) >= 0 && compare(x, upper) < 0;
    }
    case "~": {
      const upper = [v[0], v[1] + 1, 0];
      return (x) => compare(x, v) >= 0 && compare(x, upper) < 0;
    }
    case ">=": return (x) => compare(x, v) >= 0;
    case ">": return (x) => compare(x, v) > 0;
    case "<=": return (x) => compare(x, v) <= 0;
    case "<": return (x) => compare(x, v) < 0;
    default: return (x) => compare(x, v) === 0;
  }
}

/** Supports ^, ~, >=, >, <=, <, exact, space-joined AND and `||`. Throws on anything else. */
export function satisfiesRange(range, version) {
  const v = parseVersion(version);
  return String(range)
    .split("||")
    .some((alt) => {
      const tokens = alt.trim().split(/\s+/).filter(Boolean);
      if (tokens.length === 0) throw new ReleaseWatchError(`Cannot read version range "${range}".`);
      return tokens.map((t) => comparator(t, range)).every((test) => test(v));
    });
}

export async function fetchLatestVersion(fetchJson) {
  let body;
  try {
    body = await fetchJson(REGISTRY_LATEST);
  } catch (err) {
    throw new ReleaseWatchError(
      `Could not read the latest passkey-kit version from npm: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  if (!body || typeof body.version !== "string") {
    throw new ReleaseWatchError("npm registry response has no string `version` field.");
  }
  return body.version;
}

/**
 * `in-range`: nothing to do. `out-of-range`: `kind` is "major" when the new
 * release's major exceeds every version the range names, otherwise "minor".
 */
export async function checkPasskeyKitRelease({ peerRange, fetchLatest }) {
  const latest = await fetchLatest();
  if (satisfiesRange(peerRange, latest)) return { status: "in-range", latest, peerRange };
  const named = String(peerRange).match(/\d+\.\d+\.\d+/g) ?? [];
  const ceilingMajor = Math.max(...named.map((n) => parseVersion(n)[0]));
  const kind = parseVersion(latest)[0] > ceilingMajor ? "major" : "minor";
  return { status: "out-of-range", kind, latest, peerRange };
}

const TITLE_PREFIX = "passkey-kit release outside supported range:";

export function trackingIssueTitle(latest) {
  return `${TITLE_PREFIX} ${latest}`;
}

function trackingIssueBody({ latest, peerRange, kind }) {
  return [
    `passkey-kit ${latest} is a new ${kind} release outside the declared peer range \`${peerRange}\`, so consumers will not receive it automatically.`,
    "",
    "- Review the passkey-kit changelog and deployment manifest for breaking changes.",
    "- Re-run the wasm hash check against the new version before widening the range.",
    "- Widen `peerDependencies[\"passkey-kit\"]` once the SDK is verified, or close this issue with the reason it is being held back.",
    "",
    "Opened by the scheduled passkey-kit release watch. It updates this issue if an even newer release appears.",
  ].join("\n");
}

/**
 * Open one tracking issue, or update the open one when a newer release lands.
 * `github` supplies listOpenIssues(), createIssue({title, body}) and
 * updateIssue(number, {title, body}).
 */
export async function ensureTrackingIssue({ github, latest, peerRange, kind }) {
  const title = trackingIssueTitle(latest);
  const body = trackingIssueBody({ latest, peerRange, kind });
  const open = (await github.listOpenIssues()).filter((i) => i.title.startsWith(TITLE_PREFIX));
  const same = open.find((i) => i.title === title);
  if (same) return { action: "unchanged", number: same.number };
  const existing = open[0];
  if (existing) {
    await github.updateIssue(existing.number, { title, body });
    return { action: "updated", number: existing.number };
  }
  const created = await github.createIssue({ title, body });
  return { action: "created", number: created.number };
}
