import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

function packageNameFromSpecifier(specifier) {
  if (specifier.startsWith("@")) {
    const versionSeparator = specifier.indexOf("@", 1);
    return versionSeparator === -1 ? specifier : specifier.slice(0, versionSeparator);
  }
  return specifier.split("@", 1)[0];
}

export function extractInstalledPackageNames(markdown) {
  const names = new Set();
  const fences = markdown.matchAll(/```(?:sh|bash|shell)?\s*\r?\n([\s\S]*?)```/gi);

  for (const fence of fences) {
    const logicalLines = fence[1].replace(/\\\r?\n/g, " ").split(/\r?\n/);
    for (const rawLine of logicalLines) {
      const line = rawLine.trim().replace(/^\$\s*/, "");
      const command = /^npm\s+(?:install|i|add)\s+(.+)$/.exec(line);
      if (!command) continue;

      for (const token of command[1].match(/"[^"]+"|'[^']+'|\S+/g) ?? []) {
        const unquoted = token.replace(/^['"]|['"]$/g, "");
        if (unquoted.startsWith("-") || unquoted === "&&") continue;
        if (/^(npm|npx|node)$/.test(unquoted)) break;
        names.add(packageNameFromSpecifier(unquoted));
      }
    }
  }

  return [...names];
}

export function auditReadmePackageName({ manifest, markdown, readmePath = "README.md" }) {
  if (typeof manifest.name !== "string" || manifest.name.length === 0) {
    throw new Error("Package manifest must declare a name");
  }
  const installedNames = extractInstalledPackageNames(markdown);
  return {
    packageName: manifest.name,
    readmePath,
    installedNames,
    valid: installedNames.includes(manifest.name),
  };
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

async function packageDirectories(rootDirectory) {
  const rootManifest = await readJson(path.join(rootDirectory, "package.json"));
  const directories = [rootDirectory];
  for (const pattern of rootManifest.workspaces ?? []) {
    if (!pattern.endsWith("/*")) {
      throw new Error(`Only one-level workspace globs are supported by this check: ${pattern}`);
    }
    const parent = path.join(rootDirectory, pattern.slice(0, -2));
    for (const entry of await readdir(parent, { withFileTypes: true })) {
      if (entry.isDirectory()) directories.push(path.join(parent, entry.name));
    }
  }
  return directories;
}

export async function auditRepositoryReadmes(rootDirectory) {
  const results = [];
  for (const directory of await packageDirectories(rootDirectory)) {
    try {
      const manifest = await readJson(path.join(directory, "package.json"));
      const readmePath = path.join(directory, "README.md");
      const markdown = await readFile(readmePath, "utf8");
      results.push(auditReadmePackageName({
        manifest,
        markdown,
        readmePath: path.relative(rootDirectory, readmePath) || "README.md",
      }));
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  }
  return results;
}

async function main() {
  const rootDirectory = path.resolve(process.argv[2] ?? ".");
  const results = await auditRepositoryReadmes(rootDirectory);
  for (const result of results) {
    console.log(
      `[${result.valid ? "OK" : "ERROR"}] ${result.readmePath}: ` +
        `${result.packageName} ${result.valid ? "is documented" : "is missing from install commands"}`,
    );
  }
  if (results.some((result) => !result.valid)) process.exitCode = 1;
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
