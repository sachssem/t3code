import { DEFAULT_DIFF_COLLAPSE_PATH_PATTERNS } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";
import {
  areAllDiffFilesCollapsed,
  toggleAllDiffFiles,
  initialCollapsedDiffFileKeys,
  isGeneratedDiffFile,
  compileDiffCollapsePatterns,
  matchesDiffCollapsePatterns,
} from "./diffCollapse";

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
      pathPatterns: [],
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

describe("diff collapse patterns", () => {
  const { matchers } = compileDiffCollapsePatterns(DEFAULT_DIFF_COLLAPSE_PATH_PATTERNS);

  it.each([
    "apps/web/src/foo.test.ts",
    "src/foo.spec.jsx",
    "src/__tests__/foo.ts",
    "src/__snapshots__/foo.ts.snap",
    "test/helpers.rb",
    "pkg/tests/fixtures/data.json",
    "server/handler_test.go",
    "spec/models/user_spec.rb",
    "tests_dir/test_api.py",
    "src/main/java/com/acme/WidgetTest.java",
    "Sources/AppTests/ParserTests.swift",
  ])("folds %s by default", (path) => {
    expect(matchesDiffCollapsePatterns(path, matchers)).toBe(true);
  });

  it.each([
    "src/testing/setup.ts",
    "src/latest.ts",
    "src/contest.go",
    "src/attestation.py",
    "src/protest/index.ts",
    "docs/testimonials.md",
    "src/Manifest.java",
  ])("leaves %s open by default", (path) => {
    expect(matchesDiffCollapsePatterns(path, matchers)).toBe(false);
  });

  it("sets aside an entry that does not compile and skips blank lines", () => {
    const compiled = compileDiffCollapsePatterns(["  ^docs/ ", "", "([unclosed"]);
    expect(compiled.invalid).toEqual(["([unclosed"]);
    expect(matchesDiffCollapsePatterns("docs/a.md", compiled.matchers)).toBe(true);
    expect(matchesDiffCollapsePatterns("src/a.ts", compiled.matchers)).toBe(false);
  });

  it("matches nothing once the list is empty", () => {
    expect(
      matchesDiffCollapsePatterns("src/a.test.ts", compileDiffCollapsePatterns([]).matchers),
    ).toBe(false);
  });
});

const FILE_KEYS = ["src/app.ts", "src/index.ts"];
const FIRST_FILE_KEY = FILE_KEYS[0]!;

describe("diff collapse controls", () => {
  it("reports whether every rendered file is collapsed", () => {
    expect(areAllDiffFilesCollapsed(FILE_KEYS, new Set(FILE_KEYS))).toBe(true);
    expect(areAllDiffFilesCollapsed(FILE_KEYS, new Set([FIRST_FILE_KEY]))).toBe(false);
    expect(areAllDiffFilesCollapsed([], new Set())).toBe(false);
  });

  it("collapses all files when any rendered file is expanded", () => {
    expect(toggleAllDiffFiles(FILE_KEYS, new Set([FIRST_FILE_KEY]))).toEqual(new Set(FILE_KEYS));
  });

  it("expands all files when every rendered file is collapsed", () => {
    expect(toggleAllDiffFiles(FILE_KEYS, new Set(FILE_KEYS))).toEqual(new Set());
  });
});

describe("initialCollapsedDiffFileKeys", () => {
  const files = [
    { fileKey: "k-app", path: "src/app.ts" },
    { fileKey: "k-msg", path: "src/paraglide/messages/en.js" },
    { fileKey: "k-test", path: "src/app.test.ts" },
  ];
  const pathPatterns = [/\.test\.ts$/];

  it("collapses generated and matching files unless every file starts collapsed", () => {
    const generatedPaths = new Set(["src/paraglide/messages/en.js"]);
    expect(
      initialCollapsedDiffFileKeys(files, {
        allCollapsed: false,
        generatedFiles: true,
        generatedPaths,
        pathPatterns,
      }),
    ).toEqual(new Set(["k-msg", "k-test"]));
    expect(
      initialCollapsedDiffFileKeys(files, {
        allCollapsed: true,
        generatedFiles: true,
        generatedPaths,
        pathPatterns,
      }),
    ).toEqual(new Set(["k-app", "k-msg", "k-test"]));
    expect(
      initialCollapsedDiffFileKeys(files, {
        allCollapsed: false,
        generatedFiles: true,
        generatedPaths: new Set(),
        pathPatterns: [],
      }),
    ).toEqual(new Set());
  });
});
