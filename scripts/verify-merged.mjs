#!/usr/bin/env node
// Assert that a merged PR's CONTENT is actually on main.
//
// WHY THIS EXISTS. Content has been reported merged and not been on main in this
// repository more than once, and the causes were misattributed twice before the
// real mechanisms were identified. Ported from vellar-facilitator, which hit the
// same class of failure five times.
//
// The mechanism that produced THIS repo's most recent loss (2026-08-14):
//
//   A STACKED PR merged successfully into its base — and the base had already
//   merged to main 19 seconds earlier, so it was no longer a route to main.
//   #188 merged into `feat/smart-account-layer2` at 23:37:18; #187 had merged
//   that branch to main at 23:36:59. Both merges were honest. Both PRs report
//   MERGED to this day. The audit and thirteen security fixes — including a
//   Critical — simply landed somewhere main does not reach.
//
//   NOT merge order. NOT squash. The base stopped being a path to main between
//   the child PR being opened and it being merged.
//
// The rule that follows: never stack a PR whose base is about to merge — or if
// you must, verify the base is still the path to main AT THE MOMENT THE CHILD
// MERGES, not when it was opened. CHECK 1 below is that verification.
//
// The other class this catches, seen in the facilitator: a doc script anchored
// on text that did not exist, so `String.replace()` silently no-opped and the
// "merged" PR carried no change. CHECK 3 is that one.
//
// ── WHY NOT `git merge-base --is-ancestor <head> main` ──────────────────────
// Because this repo squash-merges. A squash rewrites the branch into one new
// commit, so the PR's head SHA is NEVER an ancestor of main — the check reports
// failure for perfectly healthy merges, and would have reported the same failure
// for #34. A check that fails identically for the good and the bad case carries
// no information. Ancestry is used here only when a real merge commit exists.
//
// What actually distinguishes the cases is CONTENT: did the lines this PR added
// arrive in main's copy of those files?
//
// Usage:
//   node scripts/verify-merged.mjs 187 188 189
//   node scripts/verify-merged.mjs --selftest    # 188 must FAIL
//
// Exit 0 only if every PR passes. Run it after every merge.

import { execFileSync } from "node:child_process";

const sh = (cmd, args) => execFileSync(cmd, args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
const gh = (args) => JSON.parse(sh("gh", args));

/** Lines a human would recognise: long enough to be distinctive, not scaffolding. */
function distinctiveAdditions(patch) {
  const byFile = new Map();
  let file = null;
  for (const line of patch.split("\n")) {
    const m = /^\+\+\+ b\/(.+)$/.exec(line);
    if (m) {
      file = m[1];
      if (!byFile.has(file)) byFile.set(file, []);
      continue;
    }
    if (!file || !line.startsWith("+") || line.startsWith("+++")) continue;
    const body = line.slice(1).trim();
    // Skip scaffolding that legitimately recurs everywhere and would pass by
    // coincidence: braces, imports, short fragments, pure punctuation.
    if (body.length < 25) continue;
    if (/^(import |export \{|\}|\);|\* |\/\/ |# )/.test(body)) continue;
    byFile.get(file).push(body);
  }
  return byFile;
}

function verify(pr) {
  const meta = gh(["pr", "view", String(pr), "--json", "state,mergedAt,baseRefName,headRefName,headRefOid,mergeCommit,title"]);
  const problems = [];
  const notes = [];
  let branchTipSeen = false;

  if (meta.state !== "MERGED") problems.push(`state is ${meta.state}, not MERGED`);

  // CHECK 1 — the base. This alone catches the stacked case: #188 was MERGED,
  // but into `feat/smart-account-layer2`, not into main — and that branch had
  // already merged to main 19 seconds earlier.
  if (meta.baseRefName !== "main") {
    problems.push(
      `merged into "${meta.baseRefName}", NOT main — if that branch was squash-merged first, this content is unreachable`,
    );
  }

  // CHECK 1b — commits pushed to the branch AFTER the merge.
  //
  // Added after this script returned LANDED for #45 while two thirds of the work
  // was missing from main. It was not wrong: `gh pr diff` reports what was
  // MERGED, so it answered "is what was merged on main?" — truthfully — while
  // the question actually being asked was "is everything I wrote on main?".
  //
  // The cause was pushing two commits to the branch SEVEN MINUTES after the PR
  // was squash-merged and closed. GitHub does not reopen or re-diff a merged PR,
  // so those commits belong to no PR at all and land nowhere.
  if (meta.mergedAt) {
    const mergedAtMs = Date.parse(meta.mergedAt);
    // Distinguish "branch deleted" (healthy, nothing to check) from "we could
    // not work out the branch" (a bug in this script). The first version
    // swallowed both, so a missing field made the check silently pass — the
    // exact failure it was written to catch, one level up.
    let branchTip = "";
    if (!meta.headRefName) {
      problems.push("could not determine the head branch — this check did not run, treat as unverified");
    } else {
      try {
        branchTip = sh("git", ["log", "-1", "--format=%cI %h %s", `origin/${meta.headRefName}`]).trim();
      } catch {
        /* ref absent: the branch was deleted on merge, which is the healthy case */
      }
    }
    if (branchTip) {
      const tipMs = Date.parse(branchTip.split(" ")[0]);
      branchTipSeen = true;
      if (Number.isFinite(tipMs) && tipMs > mergedAtMs + 60_000) {
        problems.push(
          `branch "${meta.headRefName}" has commits AFTER the merge (${branchTip.slice(0, 60)}…) — ` +
            `they belong to no PR and are not on main. Open a new PR for them`,
        );
      }
    }
  }

  // CHECK 2 — provenance on main. A squash commit referencing (#N), or a real
  // merge commit that is an ancestor.
  const squash = sh("git", ["log", "origin/main", "--oneline", `--grep=(#${pr})`, "-1"]).trim();
  const mergeSha = meta.mergeCommit?.oid;
  let ancestor = false;
  if (mergeSha) {
    try {
      execFileSync("git", ["merge-base", "--is-ancestor", mergeSha, "origin/main"], { stdio: "ignore" });
      ancestor = true;
    } catch {
      /* not an ancestor */
    }
  }
  if (!squash && !ancestor) problems.push(`no commit on main references (#${pr}) and no merge commit is an ancestor`);
  else notes.push(squash ? `on main as ${squash.split(" ")[0]}` : `merge commit ${mergeSha.slice(0, 8)} is an ancestor`);

  // CHECK 3 — the content itself. The only check that would have caught the
  // silent-no-op class, where the PR was merged into main correctly and simply
  // contained nothing.
  const patch = sh("gh", ["pr", "diff", String(pr), "--patch"]);
  const additions = distinctiveAdditions(patch);
  let filesChecked = 0;
  for (const [file, lines] of additions) {
    if (lines.length === 0) continue;
    filesChecked++;
    let current;
    try {
      current = sh("git", ["show", `origin/main:${file}`]);
    } catch {
      problems.push(`${file}: added by this PR but absent from main`);
      continue;
    }
    const landed = lines.filter((l) => current.includes(l)).length;

    // Was this file rewritten on main AFTER the PR merged? If so, "none of its
    // lines are present" is supersession, not loss.
    //
    // Added because #186 reported NOT LANDED on 14 missing README lines that had
    // genuinely landed and were then rewritten by #187. A verification tool that
    // reports false failures is worse than none: it trains the reader to ignore
    // it, which is the exact outcome this script exists to prevent. The line
    // count alone could not tell the two apart.
    let supersededAfterMerge = false;
    if (landed === 0 && meta.mergedAt) {
      try {
        const later = sh("git", [
          "log",
          "origin/main",
          `--since=${meta.mergedAt}`,
          "--format=%h",
          "--",
          file,
        ]).trim();
        supersededAfterMerge = later.length > 0;
      } catch {
        /* treat as not superseded — fail loudly rather than pass quietly */
      }
    }

    // "None present" is only evidence of a missing landing when there were
    // enough candidate lines for that to mean something, AND nothing rewrote the
    // file afterwards.
    if (landed === 0 && lines.length >= 3 && !supersededAfterMerge) {
      problems.push(`${file}: NONE of its ${lines.length} distinctive added lines are in main`);
    } else if (landed === 0 && supersededAfterMerge) {
      notes.push(
        `${file}: its ${lines.length} added line(s) are absent, but the file was rewritten on main after this merge — supersession, not loss. Confirm by eye if it matters`,
      );
    } else if (landed === 0) {
      notes.push(
        `${file}: its ${lines.length} added line(s) are absent — too few to judge; likely superseded by a later PR, worth an eye`,
      );
    } else if (landed < lines.length * 0.5) {
      notes.push(`${file}: only ${landed}/${lines.length} added lines present — later edits, or a partial landing`);
    }
  }
  if (filesChecked === 0) notes.push("no substantive additions to verify (deletions/renames only)");

  return { pr, title: meta.title, problems, notes, branchChecked: Boolean(branchTipSeen) };
}

const selftest = process.argv.includes("--selftest");
const prs = selftest ? [188] : process.argv.slice(2).filter((a) => /^\d+$/.test(a));
if (prs.length === 0) {
  console.error("usage: node scripts/verify-merged.mjs <pr>...   |   --selftest");
  process.exit(2);
}

let failed = 0;
for (const pr of prs) {
  const r = verify(pr);
  const ok = r.problems.length === 0;
  if (!ok) failed++;
  // State the QUESTION, not just the verdict. "Is what was merged on main?" and
  // "is everything I wrote on main?" have the same answer almost always, and
  // diverge exactly when commits land on a closed PR's branch — which is how a
  // truthful LANDED once covered two-thirds of a PR being missing. A correct
  // answer to the wrong question is harder to catch than a wrong one, because
  // there is nothing to disbelieve.
  console.log(`\n  ${ok ? "LANDED" : "NOT LANDED"}  #${r.pr}  ${r.title.slice(0, 62)}`);
  console.log(`            ? checked: the MERGED diff is on main${r.branchChecked ? ", and the branch has nothing newer" : " (branch gone — nothing newer to check)"}`);
  for (const n of r.notes) console.log(`            · ${n}`);
  for (const p of r.problems) console.log(`      FAIL  ${p}`);
}

if (selftest) {
  // #188 is this repo's known-bad case, preserved deliberately: MERGED, but into
  // a branch that had already merged to main. If this ever reports LANDED, the
  // check has regressed and cannot be trusted on a real merge.
  const pass = failed === 1;
  console.log(`\n  SELF-TEST: #188 must NOT land — ${pass ? "correct" : "REGRESSED, this script is not trustworthy"}`);
  process.exit(pass ? 0 : 1);
}

console.log(`\n  ${prs.length} PR(s) checked, ${failed} not landed.`);
process.exit(failed ? 1 : 0);
