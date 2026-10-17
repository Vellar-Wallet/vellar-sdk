import ts from "typescript";
import path from "node:path";

export type ExportSymbolKind =
  | "function"
  | "variable"
  | "class"
  | "interface"
  | "type"
  | "enum"
  | "namespace"
  | "unknown";

export interface ExportSymbolDescriptor {
  name: string;
  kind: ExportSymbolKind;
  isValue: boolean;
  isType: boolean;
  /** Canonical normalized TypeScript type/signature string for this export. */
  signature: string;
}

export interface ApiSurfaceSnapshot {
  packageName: string;
  version: string;
  entryPoint: string;
  exports: Record<string, ExportSymbolDescriptor>;
}

export interface ChangedExportEntry {
  name: string;
  kind: ExportSymbolKind;
  previousSignature: string;
  currentSignature: string;
  previousKind: ExportSymbolKind;
  currentKind: ExportSymbolKind;
  breaking: boolean;
  reason: string;
}

export interface ApiSurfaceDiffResult {
  baselineVersion: string;
  currentVersion: string;
  added: ExportSymbolDescriptor[];
  removed: ExportSymbolDescriptor[];
  changed: ChangedExportEntry[];
  hasBreakingChanges: boolean;
  breakingSymbols: string[];
}

export interface ChangelogVerificationResult {
  passed: boolean;
  acknowledgedViaFlag: boolean;
  undocumentedBreakingSymbols: string[];
  documentedBreakingSymbols: string[];
  latestChangelogVersion: string | null;
  message: string;
}

function classifySymbol(
  symbol: ts.Symbol,
  checker: ts.TypeChecker
): { kind: ExportSymbolKind; isValue: boolean; isType: boolean } {
  const resolved =
    symbol.flags & ts.SymbolFlags.Alias
      ? checker.getAliasedSymbol(symbol)
      : symbol;
  const flags = resolved.flags;
  const isValue = (flags & ts.SymbolFlags.Value) !== 0;
  const isType = (flags & ts.SymbolFlags.Type) !== 0;

  let kind: ExportSymbolKind = "unknown";
  if (flags & ts.SymbolFlags.Function) {
    kind = "function";
  } else if (flags & ts.SymbolFlags.Class) {
    kind = "class";
  } else if (flags & ts.SymbolFlags.Enum) {
    kind = "enum";
  } else if (
    flags & ts.SymbolFlags.ValueModule ||
    flags & ts.SymbolFlags.NamespaceModule
  ) {
    kind = "namespace";
  } else if (flags & ts.SymbolFlags.Variable) {
    kind = "variable";
  } else if (flags & ts.SymbolFlags.Interface) {
    kind = "interface";
  } else if (flags & ts.SymbolFlags.TypeAlias) {
    kind = "type";
  }

  return { kind, isValue, isType };
}

function formatSymbolSignature(
  symbol: ts.Symbol,
  checker: ts.TypeChecker,
  enclosingFile: ts.SourceFile
): string {
  const resolved =
    symbol.flags & ts.SymbolFlags.Alias
      ? checker.getAliasedSymbol(symbol)
      : symbol;

  const formatFlags =
    ts.TypeFormatFlags.NoTruncation |
    ts.TypeFormatFlags.WriteArrayAsGenericType |
    ts.TypeFormatFlags.UseFullyQualifiedType;

  // Value symbol (function, variable, class, enum, namespace)
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

    // Namespace export (e.g. `export * as experimental from "./experimental-exports"`)
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

  // Type-only symbol (interface, type alias)
  const declaredType = checker.getDeclaredTypeOfSymbol(resolved);
  const props = declaredType.getProperties();
  if (
    props.length > 0 &&
    (resolved.flags & ts.SymbolFlags.Interface) !== 0
  ) {
    const propStrings = props
      .map((prop) => {
        const optional = (prop.flags & ts.SymbolFlags.Optional) !== 0 ? "?" : "";
        const propDecl = prop.valueDeclaration ?? prop.declarations?.[0] ?? enclosingFile;
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

/**
 * Extract the public export surface (both runtime values and TypeScript types)
 * from an entry file (defaults to `src/index.ts`).
 */
export function extractPublicApiSurface(options: {
  rootDir: string;
  entryFile?: string;
  packageName?: string;
  version?: string;
}): ApiSurfaceSnapshot {
  const {
    rootDir,
    entryFile = "src/index.ts",
    packageName = "vellar-sdk",
    version = "0.0.0",
  } = options;

  const absEntry = path.resolve(rootDir, entryFile);
  const configPath = ts.findConfigFile(
    rootDir,
    ts.sys.fileExists,
    "tsconfig.json"
  );

  let compilerOptions: ts.CompilerOptions = {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    strict: true,
    skipLibCheck: true,
  };

  if (configPath) {
    const configFile = ts.readConfigFile(configPath, ts.sys.readFile);
    const parsed = ts.parseJsonConfigFileContent(
      configFile.config,
      ts.sys,
      path.dirname(configPath)
    );
    compilerOptions = { ...parsed.options, noEmit: true };
  }

  const program = ts.createProgram([absEntry], compilerOptions);
  const checker = program.getTypeChecker();
  const sourceFile = program.getSourceFile(absEntry);
  if (!sourceFile) {
    throw new Error(`Unable to load entry source file: ${absEntry}`);
  }

  const moduleSymbol = checker.getSymbolAtLocation(sourceFile);
  if (!moduleSymbol) {
    throw new Error(`Entry file ${entryFile} is not a TypeScript module`);
  }

  const exportedSymbols = checker.getExportsOfModule(moduleSymbol);
  const exportsMap: Record<string, ExportSymbolDescriptor> = {};

  for (const sym of exportedSymbols) {
    const name = sym.getName();
    const { kind, isValue, isType } = classifySymbol(sym, checker);
    const signature = formatSymbolSignature(sym, checker, sourceFile);
    exportsMap[name] = {
      name,
      kind,
      isValue,
      isType,
      signature,
    };
  }

  // Sort keys deterministically
  const sortedExports: Record<string, ExportSymbolDescriptor> = {};
  for (const key of Object.keys(exportsMap).sort()) {
    sortedExports[key] = exportsMap[key];
  }

  return {
    packageName,
    version,
    entryPoint: entryFile,
    exports: sortedExports,
  };
}

/**
 * Compare a baseline API surface snapshot against a current API surface snapshot
 * and classify added, removed, and changed exports.
 */
export function diffApiSurface(
  baseline: ApiSurfaceSnapshot,
  current: ApiSurfaceSnapshot
): ApiSurfaceDiffResult {
  const added: ExportSymbolDescriptor[] = [];
  const removed: ExportSymbolDescriptor[] = [];
  const changed: ChangedExportEntry[] = [];

  const baselineNames = new Set(Object.keys(baseline.exports));
  const currentNames = new Set(Object.keys(current.exports));

  for (const name of [...currentNames].sort()) {
    if (!baselineNames.has(name)) {
      added.push(current.exports[name]);
    }
  }

  for (const name of [...baselineNames].sort()) {
    const prev = baseline.exports[name];
    if (!currentNames.has(name)) {
      removed.push(prev);
      continue;
    }

    const curr = current.exports[name];
    if (prev.kind !== curr.kind || prev.signature !== curr.signature) {
      let breaking = true;
      let reason = `Signature changed from '${prev.signature}' to '${curr.signature}'`;

      if (prev.kind !== curr.kind) {
        reason = `Export kind changed from '${prev.kind}' to '${curr.kind}'`;
      } else if (
        prev.kind === "namespace" &&
        curr.kind === "namespace" &&
        prev.signature.startsWith("namespace {") &&
        curr.signature.startsWith("namespace {")
      ) {
        const parseMembers = (sig: string) =>
          sig
            .replace(/^namespace\s*\{\s*/, "")
            .replace(/\s*\}\s*$/, "")
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean);
        const prevMembers = parseMembers(prev.signature);
        const currMembers = new Set(parseMembers(curr.signature));
        const missingMembers = prevMembers.filter((m) => !currMembers.has(m));
        if (missingMembers.length === 0) {
          breaking = false;
          reason = "Namespace gained new exports without removing existing members";
        } else {
          reason = `Namespace removed member(s): ${missingMembers.join(", ")}`;
        }
      }

      changed.push({
        name,
        kind: curr.kind,
        previousSignature: prev.signature,
        currentSignature: curr.signature,
        previousKind: prev.kind,
        currentKind: curr.kind,
        breaking,
        reason,
      });
    }
  }

  const breakingSymbols = [
    ...removed.map((r) => r.name),
    ...changed.filter((c) => c.breaking).map((c) => c.name),
  ];

  return {
    baselineVersion: baseline.version,
    currentVersion: current.version,
    added,
    removed,
    changed,
    hasBreakingChanges: breakingSymbols.length > 0,
    breakingSymbols,
  };
}

/**
 * Extract the top-most release section from `CHANGELOG.md`.
 */
export function extractLatestChangelogSection(changelogMarkdown: string): {
  version: string | null;
  body: string;
} {
  const normalized = changelogMarkdown.replace(/\r\n/g, "\n");
  const headingRegex = /^##\s+([^\s—-]+).*$/gm;
  const matches = [...normalized.matchAll(headingRegex)];
  if (matches.length === 0) {
    return { version: null, body: normalized };
  }

  const first = matches[0];
  const startIdx = first.index! + first[0].length;
  const endIdx =
    matches.length > 1 ? matches[1].index! : normalized.length;
  return {
    version: first[1].trim(),
    body: normalized.slice(startIdx, endIdx).trim(),
  };
}

/**
 * Verify that any breaking API surface change (`removed` or breaking `changed`
 * export) is either:
 *   1. Explicitly documented by symbol name in the latest section of `CHANGELOG.md`, or
 *   2. Explicitly acknowledged via `acknowledgeBreaking: true` / `VELLAR_ACKNOWLEDGE_BREAKING_API=1`.
 */
export function verifyBreakingChangesAgainstChangelog(
  diff: ApiSurfaceDiffResult,
  changelogMarkdown: string,
  options: { acknowledgeBreaking?: boolean } = {}
): ChangelogVerificationResult {
  const { version: latestChangelogVersion, body } =
    extractLatestChangelogSection(changelogMarkdown);

  if (!diff.hasBreakingChanges) {
    return {
      passed: true,
      acknowledgedViaFlag: false,
      undocumentedBreakingSymbols: [],
      documentedBreakingSymbols: [],
      latestChangelogVersion,
      message: `API surface check passed (${diff.added.length} added, 0 removed, 0 breaking signature changes).`,
    };
  }

  const documentedBreakingSymbols: string[] = [];
  const undocumentedBreakingSymbols: string[] = [];

  for (const symbolName of diff.breakingSymbols) {
    // Check if the symbol name is mentioned in the latest changelog section
    const escaped = symbolName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const mentionPattern = new RegExp(`(?:\\b|\`)${escaped}(?:\\b|\`)`);
    if (mentionPattern.test(body)) {
      documentedBreakingSymbols.push(symbolName);
    } else {
      undocumentedBreakingSymbols.push(symbolName);
    }
  }

  if (undocumentedBreakingSymbols.length === 0) {
    return {
      passed: true,
      acknowledgedViaFlag: false,
      undocumentedBreakingSymbols: [],
      documentedBreakingSymbols,
      latestChangelogVersion,
      message: `Breaking API changes (${documentedBreakingSymbols.join(", ")}) are documented in CHANGELOG.md (${latestChangelogVersion ?? "latest"}).`,
    };
  }

  if (options.acknowledgeBreaking) {
    return {
      passed: true,
      acknowledgedViaFlag: true,
      undocumentedBreakingSymbols,
      documentedBreakingSymbols,
      latestChangelogVersion,
      message: `Breaking API changes (${diff.breakingSymbols.join(", ")}) explicitly acknowledged via override flag.`,
    };
  }

  return {
    passed: false,
    acknowledgedViaFlag: false,
    undocumentedBreakingSymbols,
    documentedBreakingSymbols,
    latestChangelogVersion,
    message:
      `Undocumented breaking API surface changes detected for [${undocumentedBreakingSymbols.join(", ")}]. ` +
      `Document each removed/changed symbol in the top section of CHANGELOG.md or pass --acknowledge-breaking (VELLAR_ACKNOWLEDGE_BREAKING_API=1) if intentional.`,
  };
}
