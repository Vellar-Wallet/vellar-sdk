/**
 * Issue #258: Supply-Chain Pinned Dependencies Verification.
 */

export function assertExactDependencyVersions(deps: Record<string, string>): {
  valid: boolean;
  unpinned: string[];
} {
  const unpinned: string[] = [];
  for (const [pkg, ver] of Object.entries(deps)) {
    if (ver.startsWith("^") || ver.startsWith("~") || ver.startsWith(">") || ver.startsWith("<")) {
      unpinned.push(`${pkg}@${ver}`);
    }
  }
  return {
    valid: unpinned.length === 0,
    unpinned,
  };
}
