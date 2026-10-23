import type { FileDiffMetadata } from "@pierre/diffs";
import { describe, expect, it } from "vite-plus/test";

import {
  getFileViewedRange,
  isFileDiffCollapsed,
  isLineInFileDiff,
  pullRequestFileFoldDefault,
  withFileDiffFold,
} from "./pullRequestDiff.logic";

/** Only the hunk ranges matter here; the viewer fills the rest in when it renders. */
function fileWithHunks(
  hunks: ReadonlyArray<{
    deletionStart: number;
    deletionCount: number;
    additionStart: number;
    additionCount: number;
  }>,
): FileDiffMetadata {
  return { name: "src/app.ts", hunks } as unknown as FileDiffMetadata;
}

describe("isLineInFileDiff", () => {
  const file = fileWithHunks([
    { deletionStart: 10, deletionCount: 3, additionStart: 10, additionCount: 5 },
    { deletionStart: 40, deletionCount: 0, additionStart: 42, additionCount: 2 },
  ]);

  it("places a line inside a hunk, on the side that hunk counts", () => {
    expect(isLineInFileDiff(file, "right", 12)).toBe(true);
    expect(isLineInFileDiff(file, "left", 11)).toBe(true);
  });

  it("includes the first line of a hunk and excludes the one past its last", () => {
    // The boundaries are where an off-by-one would quietly move a conversation between lists.
    expect(isLineInFileDiff(file, "right", 10)).toBe(true);
    expect(isLineInFileDiff(file, "right", 14)).toBe(true);
    expect(isLineInFileDiff(file, "right", 15)).toBe(false);
    expect(isLineInFileDiff(file, "left", 9)).toBe(false);
    expect(isLineInFileDiff(file, "left", 12)).toBe(true);
    expect(isLineInFileDiff(file, "left", 13)).toBe(false);
  });

  it("keeps the two sides apart, since one line number means two lines", () => {
    // The second hunk is a pure insertion: it deletes nothing, so nothing is on its left.
    expect(isLineInFileDiff(file, "right", 43)).toBe(true);
    expect(isLineInFileDiff(file, "left", 40)).toBe(false);
  });

  it("places nothing in a file whose hunks the host withheld", () => {
    expect(isLineInFileDiff(fileWithHunks([]), "right", 1)).toBe(false);
  });
});

describe("isFileDiffCollapsed", () => {
  // regression: #9174 diffs now expand by default; a reader's fold must survive new slices
  it("keeps a file the reader folded closed as the next slice arrives", () => {
    const choices = new Map([["b.ts", true]]);
    expect(isFileDiffCollapsed("b.ts", "expanded", choices)).toBe(true);
    expect(isFileDiffCollapsed("c.ts", "expanded", choices)).toBe(false);
  });

  it("folds a file marked Viewed when the Code tab mounts again with no fold choices", () => {
    expect(isFileDiffCollapsed("a.ts", "expanded", new Map(), true)).toBe(true);
    expect(isFileDiffCollapsed("a.ts", "expanded", new Map(), false)).toBe(false);
  });

  it("keeps a reader's choice when the file's Viewed mark loads later", () => {
    const choices = new Map([["a.ts", false]]);
    expect(isFileDiffCollapsed("a.ts", "expanded", choices, false)).toBe(false);
    expect(isFileDiffCollapsed("a.ts", "expanded", choices, true)).toBe(false);
  });
});

describe("withFileDiffFold", () => {
  it("records an absolute choice and keeps the same map when nothing changes", () => {
    const folded = withFileDiffFold(new Map(), "a.ts", true);
    expect(folded.get("a.ts")).toBe(true);
    expect(withFileDiffFold(folded, "a.ts", true)).toBe(folded);
    expect(withFileDiffFold(folded, "a.ts", false).get("a.ts")).toBe(false);
  });
});

describe("getFileViewedRange", () => {
  const files = ["c.ts", "a.ts", "b.ts", "d.ts"].map((fileKey) => ({ fileKey }));

  it("includes both endpoints in displayed order in either direction", () => {
    expect(getFileViewedRange(files, "b.ts", "c.ts")).toEqual(files.slice(0, 3));
    expect(getFileViewedRange(files, "c.ts", "b.ts")).toEqual(files.slice(0, 3));
    expect(getFileViewedRange(files, "a.ts", "a.ts")).toEqual([files[1]]);
  });

  it("changes only the clicked file without a current anchor", () => {
    expect(getFileViewedRange(files, "a.ts", null)).toEqual([files[1]]);
    expect(getFileViewedRange(files, "a.ts", "removed.ts")).toEqual([files[1]]);
    expect(getFileViewedRange(files, "removed.ts", "a.ts")).toEqual([]);
  });
});

describe("pullRequestFileFoldDefault", () => {
  const generatedPaths = new Set(["src/paraglide/messages/en.js"]);
  const rules = {
    generatedFiles: true,
    pathPatterns: [/\.test\.ts$/],
    generatedPaths,
  };

  it("folds tests, and leaves the rest to the saved default", () => {
    expect(pullRequestFileFoldDefault("src/a.test.ts", null, "expanded", rules)).toBe("folded");
    expect(pullRequestFileFoldDefault("src/other.ts", null, "expanded", rules)).toBe("expanded");
    expect(pullRequestFileFoldDefault("src/other.ts", null, "folded", rules)).toBe("folded");
  });

  it("leaves tests to the saved default once no pattern matches them", () => {
    const noTests = { generatedFiles: true, pathPatterns: [], generatedPaths };
    expect(pullRequestFileFoldDefault("src/a.test.ts", null, "expanded", noTests)).toBe("expanded");
  });

  it("lets the toolbar speak for every file", () => {
    expect(pullRequestFileFoldDefault("src/a.test.ts", "expanded", "folded", rules)).toBe(
      "expanded",
    );
    expect(pullRequestFileFoldDefault("src/other.ts", "folded", "expanded", rules)).toBe("folded");
  });

  it("folds generated files until the toolbar speaks, and leaves them open once that rule is off", () => {
    const path = "src/paraglide/messages/en.js";
    expect(pullRequestFileFoldDefault(path, null, "expanded", rules)).toBe("folded");
    expect(pullRequestFileFoldDefault(path, "expanded", "folded", rules)).toBe("expanded");
    const noGenerated = { ...rules, generatedPaths: new Set<string>() };
    expect(pullRequestFileFoldDefault(path, null, "expanded", noGenerated)).toBe("expanded");
  });
});

it("applies the generated preference to upstream lockfile classification too", () => {
  const rules = {
    generatedFiles: true,
    generatedPaths: new Set<string>(),
    pathPatterns: [],
  };
  expect(pullRequestFileFoldDefault("pnpm-lock.yaml", null, "expanded", rules)).toBe("folded");
  expect(
    pullRequestFileFoldDefault("pnpm-lock.yaml", null, "expanded", {
      ...rules,
      generatedFiles: false,
    }),
  ).toBe("expanded");
});
