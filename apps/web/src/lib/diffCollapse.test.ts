import { describe, expect, it } from "vite-plus/test";
import { initialCollapsedDiffFileKeys, isGeneratedDiffFile } from "./diffCollapse";

describe("generated diff defaults", () => {
  it("combines repository attributes with the shared classifier", () => {
    const paths = new Set(["src/messages.js"]);
    expect(isGeneratedDiffFile("src/messages.js", paths)).toBe(true);
    expect(isGeneratedDiffFile("pnpm-lock.yaml", paths)).toBe(true);
    expect(isGeneratedDiffFile("src/app.ts", paths)).toBe(false);
  });
  it("folds generated files and honors the global default", () => {
    const files = [
      { fileKey: "a", path: "src/messages.js" },
      { fileKey: "b", path: "pnpm-lock.yaml" },
      { fileKey: "c", path: "src/app.ts" },
    ];
    const rules = {
      allCollapsed: false,
      generatedFiles: true,
      generatedPaths: new Set(["src/messages.js"]),
    };
    expect([...initialCollapsedDiffFileKeys(files, rules)]).toEqual(["a", "b"]);
    expect([...initialCollapsedDiffFileKeys(files, { ...rules, generatedFiles: false })]).toEqual(
      [],
    );
    expect([...initialCollapsedDiffFileKeys(files, { ...rules, allCollapsed: true })]).toEqual([
      "a",
      "b",
      "c",
    ]);
  });
});
