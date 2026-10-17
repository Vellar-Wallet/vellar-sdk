#!/usr/bin/env node
// Compare the public export surface in src/index.ts against the baseline
// published version (scripts/api-surface-baseline.json or live npm tarball via
// --from-npm) and verify that any removed or breaking-changed exports are
// documented in CHANGELOG.md before prepublishOnly runs (issue #686).

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const baselinePath = path.join(root, "scripts", "api-surface-baseline.json");
const changelogPath = path.join(root, "CHANGELOG.md");
const pkgJson = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));

const args = new Set(process.argv.slice(2));
const updateBaseline = args.has("--update-baseline");
const fromNpm = args.has("--from-npm");
const jsonOutput = args.has("--json");
const acknowledgeBreaking =
  args.has("--acknowledge-breaking") ||
  process.env.VELLAR_ACKNOWLEDGE_BREAKING_API === "1";

function classifySymbol(symbol, checker) {
  const resolved =
    symbol.flags & ts.SymbolFlags.Alias
      ? checker.getAliasedSymbol(symbol)
      : symbol;
  const flags = resolved.flags;
  const isValue = (flags & ts.SymbolFlags.Value) !== 0;
  const isType = (flags & ts.SymbolFlags.Type) !== 0;

  let kind = "unknown";
  if (flags & ts.SymbolFlags.Function) kind = "function";
  else if (flags & ts.SymbolFlags.Class) kind = "class";
  else if (flags & ts.SymbolFlags.Enum) kind = "enum";
  else if (
    flags & ts.SymbolFlags.ValueModule ||
    flags & ts.SymbolFlags.NamespaceModule
  )
    kind = "namespace";
  else if (flags & ts.SymbolFlags.Variable) kind = "variable";
  else if (flags & ts.SymbolFlags.Interface) kind = "interface";
  else if (flags & ts.SymbolFlags.TypeAlias) kind = "type";

  return { kind, isValue, isType };
}

function formatSymbolSignature(symbol, checker, enclosingFile) {
  const resolved =
    symbol.flags & ts.SymbolFlags.Alias
      ? checker.getAliasedSymbol(symbol)
      : symbol;
  const formatFlags =
    ts.TypeFormatFlags.NoTruncation |
    ts.TypeFormatFlags.WriteArrayAsGenericType |
    ts.TypeFormatFlags.UseFullyQualifiedType;

  if (resolved.flags & ts.SymbolFlags.Value) {
    const decl =
      resolved.valueDeclaration ??
      resolved.declarations?.[0] ??
      enclosingFile;
    const valueType = checker.getTypeOfSymbolAtLocation(resolved, decl);
    const callSigs = valueType.getCallSignatures();
    if (callSigs.length > 0) {
      return callSigs
        .map((sig) =>
          checker.signatureToString(
            sig,
            enclosingFile,
            ts.TypeFormatFlags.NoTruncation
          )
        )
        .join(" | ");
    }
    if (
      resolved.flags &
      (ts.SymbolFlags.ValueModule | ts.SymbolFlags.NamespaceModule)
    ) {
      const exportsOfModule = checker.getExportsOfModule(resolved);
      const memberNames = exportsOfModule.map((s) => s.getName()).sort();
      return `namespace { ${memberNames.join(", ")} }`;
    }
    return checker.typeToString(valueType, enclosingFile, formatFlags);
  }

  const declaredType = checker.getDeclaredTypeOfSymbol(resolved);
  const props = declaredType.getProperties();
  if (props.length > 0 && (resolved.flags & ts.SymbolFlags.Interface) !== 0) {
    const propStrings = props
      .map((prop) => {
        const optional = (prop.flags & ts.SymbolFlags.Optional) !== 0 ? "?" : "";
        const propDecl =
          prop.valueDeclaration ?? prop.declarations?.[0] ?? enclosingFile;
        const propType = checker.getTypeOfSymbolAtLocation(prop, propDecl);
        const typeStr = checker.typeToString(
          propType,
          enclosingFile,
          ts.TypeFormatFlags.NoTruncation
        );
        return `${prop.getName()}${optional}: ${typeStr}`;
      })
      .sort();
    return `{ ${propStrings.join("; ")} }`;
  }

  return checker.typeToString(declaredType, enclosingFile, formatFlags);
}

function extractSurface(entryFilePath, version) {
  const configPath = ts.findConfigFile(root, ts.sys.fileExists, "tsconfig.json");
  const configFile = ts.readConfigFile(configPath, ts.sys.readFile);
  const parsed = ts.parseJsonConfigFileContent(
    configFile.config,
    ts.sys,
    path.dirname(configPath)
  );
  const program = ts.createProgram([entryFilePath], {
    ...parsed.options,
    noEmit: true,
  });
  const checker = program.getTypeChecker();
  const sourceFile = program.getSourceFile(entryFilePath);
  const moduleSymbol = checker.getSymbolAtLocation(sourceFile);
  const exportedSymbols = checker.getExportsOfModule(moduleSymbol);

  const exportsMap = {};
  for (const sym of exportedSymbols) {
    const name = sym.getName();
    const { kind, isValue, isType } = classifySymbol(sym, checker);
    const signature = formatSymbolSignature(sym, checker, sourceFile);
    exportsMap[name] = { name, kind, isValue, isType, signature };
  }

  const sortedExports = {};
  for (const key of Object.keys(exportsMap).sort()) {
    sortedExports[key] = exportsMap[key];
  }

  return {
    packageName: pkgJson.name,
    version,
    entryPoint: path.relative(root, entryFilePath).replace(/\\/g, "/"),
    exports: sortedExports,
  };
}

function loadNpmPublishedSurface() {
  const tmpDir = path.join(root, ".api-surface-npm-tmp");
  rmSync(tmpDir, { recursive: true, force: true });
  mkdirSync(tmpDir, { recursive: true });
  try {
    const tarballName = execFileSync("npm", ["pack", `${pkgJson.name}@latest`], {
      cwd: tmpDir,
      encoding: "utf8",
    }).trim();
    execFileSync("tar", ["-xzf", tarballName], { cwd: tmpDir });
    const npmPkg = JSON.parse(
      readFileSync(path.join(tmpDir, "package", "package.json"), "utf8")
    );
    const dtsEntry = path.join(tmpDir, "package", "dist", "index.d.ts");
    return extractSurface(dtsEntry, npmPkg.version);
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
}

const currentSurface = extractSurface(
  path.join(root, "src", "index.ts"),
  pkgJson.version
);

if (updateBaseline) {
  writeFileSync(
    baselinePath,
    JSON.stringify(currentSurface, null, 2) + "\n",
    "utf8"
  );
  console.log(
    `Updated API surface baseline (${Object.keys(currentSurface.exports).length} exports) -> scripts/api-surface-baseline.json`
  );
  process.exit(0);
}

let baselineSurface;
if (fromNpm) {
  baselineSurface = loadNpmPublishedSurface();
} else if (existsSync(baselinePath)) {
  baselineSurface = JSON.parse(readFileSync(baselinePath, "utf8"));
} else {
  console.error(
    "Missing scripts/api-surface-baseline.json. Run `node scripts/check-api-surface-diff.mjs --update-baseline` first."
  );
  process.exit(1);
}

// Compute diff
const added = [];
const removed = [];
const changed = [];

const baselineNames = new Set(Object.keys(baselineSurface.exports));
const currentNames = new Set(Object.keys(currentSurface.exports));

for (const name of [...currentNames].sort()) {
  if (!baselineNames.has(name)) {
    added.push(currentSurface.exports[name]);
  }
}

for (const name of [...baselineNames].sort()) {
  const prev = baselineSurface.exports[name];
  if (!currentNames.has(name)) {
    removed.push(prev);
    continue;
  }
  const curr = currentSurface.exports[name];
  if (prev.kind !== curr.kind || prev.signature !== curr.signature) {
    changed.push({
      name,
      kind: curr.kind,
      previousSignature: prev.signature,
      currentSignature: curr.signature,
      previousKind: prev.kind,
      currentKind: curr.kind,
      breaking: true,
      reason:
        prev.kind !== curr.kind
          ? `Export kind changed from '${prev.kind}' to '${curr.kind}'`
          : `Signature changed from '${prev.signature}' to '${curr.signature}'`,
    });
  }
}

const breakingSymbols = [
  ...removed.map((r) => r.name),
  ...changed.filter((c) => c.breaking).map((c) => c.name),
];

const changelogMd = existsSync(changelogPath)
  ? readFileSync(changelogPath, "utf8").replace(/\r\n/g, "\n")
  : "";
const headingMatches = [...changelogMd.matchAll(/^##\s+([^\s—-]+).*$/gm)];
const latestSectionBody =
  headingMatches.length > 0
    ? changelogMd.slice(
        headingMatches[0].index + headingMatches[0][0].length,
        headingMatches.length > 1 ? headingMatches[1].index : changelogMd.length
      )
    : changelogMd;

const undocumentedBreakingSymbols = breakingSymbols.filter((sym) => {
  const escaped = sym.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return !new RegExp(`(?:\\b|\`)${escaped}(?:\\b|\`)`).test(latestSectionBody);
});

const passed =
  breakingSymbols.length === 0 ||
  undocumentedBreakingSymbols.length === 0 ||
  acknowledgeBreaking;

const report = {
  baselineVersion: baselineSurface.version,
  currentVersion: currentSurface.version,
  totalBaselineExports: baselineNames.size,
  totalCurrentExports: currentNames.size,
  added: added.map((a) => a.name),
  removed: removed.map((r) => r.name),
  changed,
  breakingSymbols,
  undocumentedBreakingSymbols,
  acknowledgedViaFlag: acknowledgeBreaking,
  passed,
};

if (jsonOutput) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log(
    `API surface diff (${report.baselineVersion} -> ${report.currentVersion}): ` +
      `+${added.length} added, -${removed.length} removed, ~${changed.length} changed (${currentNames.size} total exports)`
  );
  if (!passed) {
    console.error(
      `\nERROR: Undocumented breaking API changes detected: ${undocumentedBreakingSymbols.join(", ")}\n` +
        `Document these symbols in the latest section of CHANGELOG.md or set VELLAR_ACKNOWLEDGE_BREAKING_API=1 (--acknowledge-breaking).`
    );
  }
}

if (!passed) {
  process.exit(1);
}
