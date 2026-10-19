#!/usr/bin/env node
// Issue #641 — scheduled check for a passkey-kit release outside the declared
// peer range. Opens or updates one tracking issue; fails the job if it cannot.
//   GITHUB_TOKEN=... GITHUB_REPOSITORY=owner/repo node contrib/issues-639-642/watch-passkey-release.mjs
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  checkPasskeyKitRelease,
  ensureTrackingIssue,
  fetchLatestVersion,
} from "./passkey-release-watch.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`GET ${url} -> HTTP ${res.status}`);
  return res.json();
}

function githubClient(repo, token) {
  const api = `https://api.github.com/repos/${repo}/issues`;
  const call = async (url, init = {}) => {
    const res = await fetch(url, {
      ...init,
      headers: {
        authorization: `Bearer ${token}`,
        accept: "application/vnd.github+json",
        "content-type": "application/json",
      },
    });
    if (!res.ok) throw new Error(`${init.method ?? "GET"} ${url} -> HTTP ${res.status}`);
    return res.json();
  };
  return {
    listOpenIssues: async () =>
      (await call(`${api}?state=open&per_page=100`)).filter((i) => !i.pull_request),
    createIssue: (input) => call(api, { method: "POST", body: JSON.stringify(input) }),
    updateIssue: (number, input) => call(`${api}/${number}`, { method: "PATCH", body: JSON.stringify(input) }),
  };
}

try {
  const peerRange = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).peerDependencies?.["passkey-kit"];
  if (!peerRange) throw new Error("package.json declares no passkey-kit peer range.");
  const result = await checkPasskeyKitRelease({
    peerRange,
    fetchLatest: () => fetchLatestVersion(fetchJson),
  });
  if (result.status === "in-range") {
    console.log(`passkey-kit ${result.latest} is inside ${peerRange}. Nothing to do.`);
  } else {
    const message = `passkey-kit ${result.latest} is a new ${result.kind} release outside the declared peer range ${peerRange}.`;
    const { GITHUB_TOKEN: token, GITHUB_REPOSITORY: repo } = process.env;
    if (!token || !repo) {
      throw new Error(`${message} No GITHUB_TOKEN/GITHUB_REPOSITORY set, so no tracking issue was opened.`);
    }
    const issue = await ensureTrackingIssue({ github: githubClient(repo, token), ...result });
    console.log(`${message} Tracking issue #${issue.number} ${issue.action}.`);
  }
} catch (err) {
  console.error(`watch-passkey-release failed: ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
}
