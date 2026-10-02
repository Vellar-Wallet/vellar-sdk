// Self-contained reference for issue #283: a canary npm dist-tag rollout for
// pre-1.0 releases.
//
// Today .github/workflows/publish.yml runs `npm publish --provenance --access
// public` with no `--tag`, so every tag pushed publishes straight to the
// `latest` dist-tag — the one every plain `npm install vellar-sdk` resolves
// to. There is no canary stage in which an early-adopter consumer can try a
// release before it becomes the default for everyone.
//
// This module is the decision logic that closes that gap, kept pure and
// dependency-free so it can be unit-tested rather than buried in a YAML
// `run:` block where quoting bugs hide. ROLLOUT.md in this folder carries the
// workflow wiring, the promotion process, and the consumer-validation
// checklist.
//
// THE RULE: a semver PRERELEASE tag (anything with a `-` suffix, e.g.
// v0.7.0-canary.0, v1.0.0-rc.0) publishes to the `next` dist-tag. A plain
// release tag (v0.7.0) publishes to `latest`. This follows ordinary semver
// prerelease convention rather than inventing a bespoke "canary" grammar —
// any prerelease identifier works, `canary` is simply the one the process
// names.
//
// Run with: npx tsx canary-dist-tag-rollout.ts

export type DistTag = "next" | "latest";

/**
 * The dist-tag a publish should use, given the git tag it runs from.
 *
 * A leading `v` is optional. Anything carrying a semver prerelease suffix
 * routes to `next`; everything else routes to `latest`.
 */
export function distTagFor(gitTag: string): DistTag {
  const version = gitTag.replace(/^v/, "");
  return version.includes("-") ? "next" : "latest";
}

/** A published version and the dist-tags currently pointing at it. */
export interface RegistryState {
  /** dist-tag -> version it points at. */
  distTags: Record<string, string>;
  /** Every version published to the registry. */
  published: string[];
}

export class PromotionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PromotionError";
  }
}

/**
 * Simulate publishing `version` under the dist-tag implied by its git tag.
 *
 * The property that matters, and that the tests pin: publishing a canary must
 * NOT move `latest`. That is the whole point of the stage — an ordinary
 * `npm install vellar-sdk` is unaffected until someone deliberately promotes.
 */
export function publish(state: RegistryState, gitTag: string): RegistryState {
  const version = gitTag.replace(/^v/, "");
  const tag = distTagFor(gitTag);
  return {
    published: state.published.includes(version)
      ? state.published
      : [...state.published, version],
    distTags: { ...state.distTags, [tag]: version },
  };
}

/**
 * Promote an already-published version onto `latest`.
 *
 * This does NOT build or publish a new tarball — it moves the `latest`
 * dist-tag to point at a version already on the registry, so what consumers
 * get on `latest` is byte-for-byte the artifact that was validated as a
 * canary.
 *
 * Refuses a version that was never published, so a typo fails loudly rather
 * than producing a confusing registry error or silently doing nothing.
 */
export function promoteToLatest(state: RegistryState, version: string): RegistryState {
  if (!state.published.includes(version)) {
    throw new PromotionError(
      `vellar-sdk@${version} is not published — nothing to promote. ` +
        `Published versions: ${state.published.join(", ") || "(none)"}`,
    );
  }
  return { ...state, distTags: { ...state.distTags, latest: version } };
}

/** What `npm install vellar-sdk` (no tag) would resolve to. */
export function resolveDefaultInstall(state: RegistryState): string | undefined {
  return state.distTags.latest;
}

function main() {
  // Start from a released 0.6.1 on latest.
  let state: RegistryState = {
    published: ["0.6.1"],
    distTags: { latest: "0.6.1" },
  };
  console.log("start                     :", JSON.stringify(state.distTags));

  // 1. Cut a canary. It lands on `next`; `latest` does not move.
  state = publish(state, "v0.7.0-canary.0");
  console.log("after canary publish      :", JSON.stringify(state.distTags));
  console.log("  plain install still gets:", resolveDefaultInstall(state));

  // 2. A typo'd promotion fails loudly instead of silently no-op'ing.
  try {
    promoteToLatest(state, "0.7.0-canary.99");
  } catch (err) {
    console.log("  bad promote rejected    :", (err as Error).name);
  }

  // 3. Promote the validated canary. Now `latest` moves.
  state = promoteToLatest(state, "0.7.0-canary.0");
  console.log("after promotion           :", JSON.stringify(state.distTags));
  console.log("  plain install now gets  :", resolveDefaultInstall(state));

  // 4. A plain release tag goes straight to latest, as before.
  state = publish(state, "v0.7.0");
  console.log("after plain release       :", JSON.stringify(state.distTags));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
