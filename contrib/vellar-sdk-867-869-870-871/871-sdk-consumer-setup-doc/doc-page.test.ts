import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const PAGE_PATH = new URL("./local-facilitator-for-sdk-consumers.md", import.meta.url);
const page = readFileSync(PAGE_PATH, "utf8");

describe("SDK consumer local facilitator doc (#871)", () => {
  it("covers all four required environment variables with example values", () => {
    for (const variable of [
      "PORT",
      "CATALOG_DB_URL",
      "SPONSOR_SECRET_KEY",
      "CHANNEL_ACCOUNT_SECRET_KEYS",
    ]) {
      expect(page).toContain(variable);
    }
    expect(page).toContain("`4100`");
    expect(page).toContain("`file:./data/catalog.db`");
    expect(page).toContain("50 comma separated");
  });

  it("cross-links the operator docs and the one-command startup source", () => {
    expect(page).toContain("../../../website/content/docs/operators/limits.md");
    expect(page).toContain("../../../website/content/docs/operators/configuration.md");
    expect(page).toContain("npm start");
  });

  it("cross-links the fixture generator and the local integration test", () => {
    expect(page).toContain("../870-channel-account-fixture/README.md");
    expect(page).toContain("../869-local-facilitator-integration/README.md");
  });

  it("states the maintainer follow-up needed for site navigation", () => {
    expect(page).toContain("website/lib/docs-registry.ts");
    expect(page).toContain("getting-started");
  });
});
