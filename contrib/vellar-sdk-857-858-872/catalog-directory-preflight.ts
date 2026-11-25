/**
 * Local-facilitator setup guard for #872. libSQL does not create a missing
 * directory behind CATALOG_DB_URL, so setup must check it before spawning the
 * facilitator instead of waiting for an opaque startup failure.
 */
export interface CatalogDirectoryStatus {
  readonly ready: boolean;
  readonly message: string;
}

/**
 * Returns an actionable mkdir-first failure. The startup fixture can provide
 * its own filesystem probe, keeping this reference free of process side effects.
 */
export function checkCatalogDataDirectory(
  directory: string,
  exists: (path: string) => boolean,
): CatalogDirectoryStatus {
  if (!directory.trim()) {
    return { ready: false, message: "CATALOG_DB_URL requires a local data directory path." };
  }
  if (!exists(directory)) {
    return {
      ready: false,
      message:
        `Local facilitator data directory is missing: ${directory}. ` +
        "Create it first (mkdir -p data) before starting with CATALOG_DB_URL.",
    };
  }
  return { ready: true, message: "Local facilitator data directory is ready." };
}
