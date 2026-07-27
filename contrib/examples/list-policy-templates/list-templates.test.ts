import { describe, expect, it, vi } from "vitest";
import { listPolicyTemplates, main } from "./list-templates";

describe("listPolicyTemplates", () => {
  it("returns at least 3 templates from the mock backend", async () => {
    const templates = await listPolicyTemplates();
    expect(templates.length).toBeGreaterThanOrEqual(3);
    for (const template of templates) {
      expect(typeof template.type).toBe("string");
      expect(typeof template.description).toBe("string");
      expect(template.description.length).toBeGreaterThan(0);
    }
  });
});

describe("main", () => {
  it("prints each template's id and description", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    await main();
    const templates = await listPolicyTemplates();
    expect(logSpy).toHaveBeenCalledTimes(templates.length);
    for (const template of templates) {
      expect(logSpy).toHaveBeenCalledWith(`${template.type}: ${template.description}`);
    }
    logSpy.mockRestore();
  });
});
