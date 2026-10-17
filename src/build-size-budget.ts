import fs from "node:fs";
import path from "node:path";

export interface PackageSizeBudget {
  packageName: string;
  packageDir: string;
  distDir?: string;
  measuredBaselineBytes?: number;
  /** Maximum combined size in bytes for all runtime JS bundles (.js, .cjs, .mjs) in dist/. */
  maxTotalBytes: number;
  /** Maximum size in bytes for any single runtime JS bundle file in dist/. */
  maxSingleFileBytes: number;
  notes?: string;
}

export interface DistFileEntry {
  relativePath: string;
  bytes: number;
  category: "runtime" | "types" | "sourcemap" | "other";
}

export interface PackageDistMeasurement {
  packageName: string;
  packageDir: string;
  distPath: string;
  exists: boolean;
  runtimeBytes: number;
  typesBytes: number;
  sourcemapBytes: number;
  totalBytesAllFiles: number;
  largestRuntimeFile: DistFileEntry | null;
  files: DistFileEntry[];
}

export interface PackageBudgetCheckResult {
  budget: PackageSizeBudget;
  measurement: PackageDistMeasurement;
  passed: boolean;
  exceededTotalByBytes: number;
  exceededSingleFileByBytes: number;
  errors: string[];
}

export interface WorkspaceBuildSizeEvaluation {
  passed: boolean;
  results: PackageBudgetCheckResult[];
  errors: string[];
}

export const DEFAULT_BUILD_SIZE_BUDGETS: readonly PackageSizeBudget[] = [
  {
    packageName: "vellar-sdk",
    packageDir: ".",
    distDir: "dist",
    measuredBaselineBytes: 148_480,
    maxTotalBytes: 266_240, // 260 KiB
    maxSingleFileBytes: 122_880, // 120 KiB
  },
  {
    packageName: "vellar-cli",
    packageDir: "packages/cli",
    distDir: "dist",
    measuredBaselineBytes: 32_768,
    maxTotalBytes: 81_920, // 80 KiB
    maxSingleFileBytes: 61_440, // 60 KiB
  },
  {
    packageName: "vellar-mcp-x402-payer",
    packageDir: "packages/mcp-x402-payer",
    distDir: "dist",
    measuredBaselineBytes: 57_344,
    maxTotalBytes: 122_880, // 120 KiB
    maxSingleFileBytes: 81_920, // 80 KiB
  },
] as const;

export function formatBytes(bytes: number): string {
  const kib = (bytes / 1024).toFixed(2);
  return `${bytes} B (${kib} KiB)`;
}

function classifyDistFile(fileName: string): DistFileEntry["category"] {
  if (fileName.endsWith(".map")) return "sourcemap";
  if (
    fileName.endsWith(".d.ts") ||
    fileName.endsWith(".d.cts") ||
    fileName.endsWith(".d.mts")
  ) {
    return "types";
  }
  if (
    fileName.endsWith(".js") ||
    fileName.endsWith(".cjs") ||
    fileName.endsWith(".mjs")
  ) {
    return "runtime";
  }
  return "other";
}

function collectFilesRecursive(dir: string, baseDir: string = dir): DistFileEntry[] {
  const entries: DistFileEntry[] = [];
  for (const dirent of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, dirent.name);
    if (dirent.isDirectory()) {
      entries.push(...collectFilesRecursive(fullPath, baseDir));
    } else if (dirent.isFile()) {
      const stat = fs.statSync(fullPath);
      const relativePath = path.relative(baseDir, fullPath).replace(/\\/g, "/");
      entries.push({
        relativePath,
        bytes: stat.size,
        category: classifyDistFile(dirent.name),
      });
    }
  }
  return entries.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
}

/**
 * Measure the built `dist/` output of a workspace package.
 */
export function measurePackageDistSize(
  rootDir: string,
  budget: Pick<PackageSizeBudget, "packageName" | "packageDir" | "distDir">
): PackageDistMeasurement {
  const distPath = path.resolve(
    rootDir,
    budget.packageDir,
    budget.distDir ?? "dist"
  );
  if (!fs.existsSync(distPath)) {
    return {
      packageName: budget.packageName,
      packageDir: budget.packageDir,
      distPath,
      exists: false,
      runtimeBytes: 0,
      typesBytes: 0,
      sourcemapBytes: 0,
      totalBytesAllFiles: 0,
      largestRuntimeFile: null,
      files: [],
    };
  }

  const files = collectFilesRecursive(distPath);
  let runtimeBytes = 0;
  let typesBytes = 0;
  let sourcemapBytes = 0;
  let totalBytesAllFiles = 0;
  let largestRuntimeFile: DistFileEntry | null = null;

  for (const file of files) {
    totalBytesAllFiles += file.bytes;
    if (file.category === "runtime") {
      runtimeBytes += file.bytes;
      if (!largestRuntimeFile || file.bytes > largestRuntimeFile.bytes) {
        largestRuntimeFile = file;
      }
    } else if (file.category === "types") {
      typesBytes += file.bytes;
    } else if (file.category === "sourcemap") {
      sourcemapBytes += file.bytes;
    }
  }

  return {
    packageName: budget.packageName,
    packageDir: budget.packageDir,
    distPath,
    exists: true,
    runtimeBytes,
    typesBytes,
    sourcemapBytes,
    totalBytesAllFiles,
    largestRuntimeFile,
    files,
  };
}

/**
 * Evaluate built output sizes for all workspace packages against their configured budgets.
 */
export function evaluateBuildSizeBudgets(
  rootDir: string,
  budgets: readonly PackageSizeBudget[] = DEFAULT_BUILD_SIZE_BUDGETS
): WorkspaceBuildSizeEvaluation {
  const results: PackageBudgetCheckResult[] = [];
  const allErrors: string[] = [];

  for (const budget of budgets) {
    const measurement = measurePackageDistSize(rootDir, budget);
    const errors: string[] = [];
    let exceededTotalByBytes = 0;
    let exceededSingleFileByBytes = 0;

    if (!measurement.exists || measurement.files.length === 0) {
      errors.push(
        `Package "${budget.packageName}" (${budget.packageDir}/${budget.distDir ?? "dist"}) has no build output. Run the package build before checking size budgets.`
      );
    } else {
      if (measurement.runtimeBytes > budget.maxTotalBytes) {
        exceededTotalByBytes = measurement.runtimeBytes - budget.maxTotalBytes;
        errors.push(
          `Package "${budget.packageName}" exceeded its total dist runtime budget by ${formatBytes(exceededTotalByBytes)} ` +
            `(measured ${formatBytes(measurement.runtimeBytes)} vs budget ${formatBytes(budget.maxTotalBytes)}). ` +
            `Check for un-externalized dependencies or see docs/build-size-budgets.md to deliberately raise the budget.`
        );
      }

      if (
        measurement.largestRuntimeFile &&
        measurement.largestRuntimeFile.bytes > budget.maxSingleFileBytes
      ) {
        exceededSingleFileByBytes =
          measurement.largestRuntimeFile.bytes - budget.maxSingleFileBytes;
        errors.push(
          `Package "${budget.packageName}" chunk "${measurement.largestRuntimeFile.relativePath}" exceeded maxSingleFileBytes by ${formatBytes(exceededSingleFileByBytes)} ` +
            `(measured ${formatBytes(measurement.largestRuntimeFile.bytes)} vs budget ${formatBytes(budget.maxSingleFileBytes)}).`
        );
      }
    }

    const passed = errors.length === 0;
    allErrors.push(...errors);
    results.push({
      budget,
      measurement,
      passed,
      exceededTotalByBytes,
      exceededSingleFileByBytes,
      errors,
    });
  }

  return {
    passed: allErrors.length === 0,
    results,
    errors: allErrors,
  };
}

/**
 * Format a human-readable build size summary report across all workspace packages.
 */
export function formatBuildSizeReport(
  evaluation: WorkspaceBuildSizeEvaluation
): string {
  const lines: string[] = ["Workspace Build Size Budget Report:"];
  for (const res of evaluation.results) {
    const { budget, measurement, passed } = res;
    const status = passed ? "PASS" : "FAIL";
    const pct =
      budget.maxTotalBytes > 0
        ? ((measurement.runtimeBytes / budget.maxTotalBytes) * 100).toFixed(1)
        : "0.0";
    lines.push(
      `  [${status}] ${budget.packageName} (${budget.packageDir}): ` +
        `${formatBytes(measurement.runtimeBytes)} / ${formatBytes(budget.maxTotalBytes)} (${pct}% of budget)`
    );
  }
  if (!evaluation.passed) {
    lines.push("", "Build size budget failures:");
    for (const err of evaluation.errors) {
      lines.push(`  - ${err}`);
    }
  }
  return lines.join("\n");
}
