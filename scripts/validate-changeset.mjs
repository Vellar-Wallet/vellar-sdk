import { execSync } from "child_process";

export function validateChangeset({ changedFiles, labels }) {
  if (labels.includes("skip-changeset") || labels.includes("no-changeset")) {
    return { valid: true, reason: "Skip label present" };
  }

  const sourceFiles = changedFiles.filter(f => f.startsWith("src/") || f.startsWith("packages/"));
  if (sourceFiles.length === 0) {
    return { valid: true, reason: "No source files changed" };
  }

  const changesets = changedFiles.filter(f => f.startsWith(".changeset/") && f.endsWith(".md"));
  if (changesets.length === 0) {
    return {
      valid: false,
      reason: "Source files changed but no changeset entry (.changeset/*.md) was added or modified."
    };
  }

  return { valid: true, reason: "Changeset present" };
}

// Check if running as script directly
const isMain = process.argv[1] && (
  process.argv[1].endsWith("validate-changeset.mjs") ||
  process.argv[1].endsWith("validate-changeset.js")
);

if (isMain) {
  try {
    const baseRef = process.env.GITHUB_BASE_REF || "main";
    const labelsEnv = process.env.PR_LABELS || "";
    const labels = labelsEnv.split(",").map(l => l.trim()).filter(Boolean);

    console.log(`Running changeset validation against base branch: ${baseRef}`);
    console.log(`PR Labels: ${JSON.stringify(labels)}`);

    // Fetch base branch to compare
    execSync(`git fetch origin ${baseRef} --depth=1`, { stdio: "inherit" });
    const diffOutput = execSync(`git diff --name-only origin/${baseRef}...HEAD`, { encoding: "utf8" });
    const changedFiles = diffOutput.split("\n").map(f => f.trim()).filter(Boolean);

    console.log(`Changed files in PR:\n${changedFiles.map(f => `  - ${f}`).join("\n")}`);

    const result = validateChangeset({ changedFiles, labels });
    console.log(`Result: ${result.reason}`);

    if (!result.valid) {
      console.error("\n[ERROR] Changeset Validation Failed!");
      console.error("This pull request modifies source files (in src/ or packages/) but does not include a changeset.");
      console.error("Please add a changeset by running 'npx changeset' or ask a maintainer to add the 'skip-changeset' label if a changeset is not required.\n");
      process.exit(1);
    }
    console.log("Changeset validation passed!");
  } catch (err) {
    console.error("Failed to validate changesets:", err.message);
    process.exit(1);
  }
}
