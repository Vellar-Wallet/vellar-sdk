#!/usr/bin/env node

import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

async function workspacePackageFiles(root, patterns) {
  const files = [];

  for (const pattern of patterns) {
    if (!pattern.endsWith("/*")) {
      files.push(resolve(root, pattern, "package.json"));
      continue;
    }

    const parent = resolve(root, pattern.slice(0, -2));
    for (const entry of await readdir(parent, { withFileTypes: true })) {
      if (entry.isDirectory()) files.push(resolve(parent, entry.name, "package.json"));
    }
  }

  return files;
}

export function oldestSupportedNode(range) {
  const match = /^>=\s*(\d+)(?:\.\d+\.\d+)?$/.exec(range ?? "");
  return match ? Number(match[1]) : undefined;
}

export async function auditNodeEngines(root) {
  const rootPackage = await readJson(resolve(root, "package.json"));
  const expected = rootPackage.engines?.node;
  const packages = [];
  const violations = [];

  if (!expected) {
    violations.push(`${rootPackage.name ?? "root package"} does not declare engines.node`);
  } else if (oldestSupportedNode(expected) === undefined) {
    violations.push(`root engines.node must use a reviewable minimum such as >=20; got ${expected}`);
  }

  const files = await workspacePackageFiles(root, rootPackage.workspaces ?? []);
  for (const file of files) {
    let pkg;
    try {
      pkg = await readJson(file);
    } catch (error) {
      if (error?.code === "ENOENT") continue;
      throw error;
    }

    const range = pkg.engines?.node;
    packages.push({ name: pkg.name, range, file });
    if (!range) {
      violations.push(`${pkg.name} does not declare engines.node`);
    } else if (expected && range !== expected) {
      violations.push(`${pkg.name} declares ${range}; expected ${expected}`);
    }
  }

  return {
    rootPackage: rootPackage.name,
    expected,
    oldest: oldestSupportedNode(expected),
    packages,
    violations,
  };
}

export async function main(argv = process.argv.slice(2)) {
  const rootArgIndex = argv.indexOf("--root");
  const root = resolve(rootArgIndex >= 0 ? argv[rootArgIndex + 1] ?? "." : ".");
  const report = await auditNodeEngines(root);

  if (report.violations.length > 0) {
    console.error("Node.js support matrix is inconsistent:");
    for (const violation of report.violations) console.error(`- ${violation}`);
    return 1;
  }

  console.log(`Node.js ${report.expected} is consistent across ${report.rootPackage} and ${report.packages.length} workspace package(s).`);
  console.log(`CI must exercise the full suite on Node.js ${report.oldest}.`);
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exitCode = await main();
}
