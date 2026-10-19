// Resolves the floor and latest published version of a dependency that satisfy
// the peer range declared in package.json. Used by the compat CI matrix
// (#635, #636) so the tested versions track package.json instead of drifting.
//
//   node contrib/issues-635-638/resolve-compat-versions.mjs @stellar/stellar-sdk
//   -> {"name":"@stellar/stellar-sdk","range":"^16.0.0","floor":"16.0.0","latest":"16.3.1"}

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { pickBounds } from "./semver-range.mjs";

export function resolveCompatVersions(name, peerRange, publishedVersions) {
  const bounds = pickBounds(publishedVersions, peerRange);
  if (!bounds) throw new Error(`No published version of ${name} satisfies "${peerRange}"`);
  return { name, range: peerRange, ...bounds };
}

function main() {
  const name = process.argv[2];
  if (!name) throw new Error("usage: resolve-compat-versions.mjs <package-name>");
  const pkg = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8"));
  const range = pkg.peerDependencies?.[name];
  if (!range) throw new Error(`${name} is not a declared peerDependency`);
  const out = execFileSync("npm", ["view", name, "versions", "--json"], {
    encoding: "utf8",
    shell: process.platform === "win32",
  });
  console.log(JSON.stringify(resolveCompatVersions(name, range, JSON.parse(out))));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main();
