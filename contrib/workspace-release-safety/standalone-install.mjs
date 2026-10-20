import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const MODULE_RESOLUTION_FAILURE = /(ERR_MODULE_NOT_FOUND|Cannot find (?:module|package))/i;

function binEntries(manifest) {
  if (typeof manifest.bin === "string") return [[manifest.name, manifest.bin]];
  return Object.entries(manifest.bin ?? {});
}

export function createSmokePlan(manifest) {
  const entries = binEntries(manifest);
  if (manifest.name === "vellar-cli") {
    const entry = entries.find(([name]) => name === "vellar");
    if (!entry) throw new Error("vellar-cli must declare the vellar binary");
    return { entry: entry[1], args: ["--help"], expectedExitCode: 0, stderrPattern: null };
  }
  if (manifest.name === "vellar-mcp-x402-payer") {
    const entry = entries.find(([name]) => name === "vellar-mcp-x402-payer");
    if (!entry) throw new Error("MCP payer must declare the vellar-mcp-x402-payer binary");
    return {
      entry: entry[1],
      args: [],
      expectedExitCode: 1,
      stderrPattern: /failed to start/i,
      clearEnvironment: [
        "VELLAR_X402_SECRET",
        "VELLAR_X402_SECRET_FILE",
        "VELLAR_X402_WALLET",
        "VELLAR_X402_RPC_URL",
        "VELLAR_X402_NETWORK",
      ],
    };
  }
  throw new Error(`No standalone smoke command is defined for ${manifest.name}`);
}

export function validatePackedFiles(manifest, packedFiles) {
  const paths = new Set(packedFiles.map((file) => file.path.replace(/^package\//, "")));
  const required = [manifest.main, manifest.module, manifest.types, ...binEntries(manifest).map(([, value]) => value)]
    .filter((value) => typeof value === "string")
    .map((value) => value.replace(/^\.\//, ""));
  const missing = required.filter((file) => !paths.has(file));
  return { valid: missing.length === 0, missing };
}

export function evaluateInstallResult(result) {
  if (result.status === 0) return { valid: true, reason: "isolated install succeeded" };
  const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
  return {
    valid: false,
    reason: MODULE_RESOLUTION_FAILURE.test(output)
      ? "isolated install exposed an undeclared or unresolved runtime dependency"
      : `isolated npm install exited with ${result.status ?? "no status"}`,
  };
}

export function evaluateSmokeResult(result, plan) {
  const stderr = result.stderr ?? "";
  const combined = `${result.stdout ?? ""}\n${stderr}`;
  if (MODULE_RESOLUTION_FAILURE.test(combined)) {
    return { valid: false, reason: "smoke command could not resolve a runtime dependency" };
  }
  if (result.status !== plan.expectedExitCode) {
    return {
      valid: false,
      reason: `smoke command exited with ${result.status ?? "no status"}; expected ${plan.expectedExitCode}`,
    };
  }
  if (plan.stderrPattern && !plan.stderrPattern.test(stderr)) {
    return { valid: false, reason: "startup failure did not reach the expected configuration guard" };
  }
  return { valid: true, reason: "standalone smoke command passed" };
}

function run(command, args, options = {}) {
  return spawnSync(command, args, {
    encoding: "utf8",
    shell: false,
    ...options,
  });
}

function parsePackResult(result, packageName) {
  if (result.status !== 0) {
    throw new Error(`npm pack failed for ${packageName}: ${result.stderr || result.stdout}`);
  }
  let records;
  try {
    records = JSON.parse(result.stdout);
  } catch {
    throw new Error(`npm pack returned invalid JSON for ${packageName}`);
  }
  const record = records[0];
  if (!record?.filename || !Array.isArray(record.files)) {
    throw new Error(`npm pack returned no artifact metadata for ${packageName}`);
  }
  return record;
}

export async function runStandaloneInstall({ rootDirectory, packageDirectory, keepTemp = false }) {
  const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
  const scratch = await mkdtemp(path.join(os.tmpdir(), "vellar-standalone-"));
  const packs = path.join(scratch, "packs");
  const consumer = path.join(scratch, "consumer");
  await mkdir(packs);
  await mkdir(consumer);

  try {
    const rootManifest = JSON.parse(await readFile(path.join(rootDirectory, "package.json"), "utf8"));
    const targetManifest = JSON.parse(
      await readFile(path.join(packageDirectory, "package.json"), "utf8"),
    );
    const rootPack = parsePackResult(
      run(npmCommand, ["pack", rootDirectory, "--json", "--pack-destination", packs]),
      rootManifest.name,
    );
    const targetPack = parsePackResult(
      run(npmCommand, ["pack", packageDirectory, "--json", "--pack-destination", packs]),
      targetManifest.name,
    );
    const packed = validatePackedFiles(targetManifest, targetPack.files);
    if (!packed.valid) {
      throw new Error(`Packed ${targetManifest.name} is missing: ${packed.missing.join(", ")}`);
    }

    await writeFile(
      path.join(consumer, "package.json"),
      JSON.stringify({ name: "standalone-smoke-consumer", private: true, type: "module" }, null, 2),
    );
    const install = run(
      npmCommand,
      [
        "install",
        "--ignore-scripts",
        "--no-audit",
        "--no-fund",
        path.join(packs, rootPack.filename),
        path.join(packs, targetPack.filename),
      ],
      { cwd: consumer },
    );
    const installEvaluation = evaluateInstallResult(install);
    if (!installEvaluation.valid) throw new Error(installEvaluation.reason);

    const plan = createSmokePlan(targetManifest);
    const environment = { ...process.env };
    for (const name of plan.clearEnvironment ?? []) delete environment[name];
    const smoke = run(
      process.execPath,
      [path.join(consumer, "node_modules", targetManifest.name, plan.entry), ...plan.args],
      { cwd: consumer, env: environment },
    );
    const smokeEvaluation = evaluateSmokeResult(smoke, plan);
    if (!smokeEvaluation.valid) throw new Error(smokeEvaluation.reason);

    return { packageName: targetManifest.name, scratch, installEvaluation, smokeEvaluation };
  } finally {
    if (!keepTemp) await rm(scratch, { recursive: true, force: true });
  }
}

async function main() {
  const packageArgument = process.argv[2];
  if (!packageArgument) {
    throw new Error("Usage: node standalone-install.mjs <workspace-package-directory> [root]");
  }
  const rootDirectory = path.resolve(process.argv[3] ?? ".");
  const packageDirectory = path.resolve(packageArgument);
  const result = await runStandaloneInstall({ rootDirectory, packageDirectory });
  console.log(`[OK] ${result.packageName}: isolated install and smoke command passed`);
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
