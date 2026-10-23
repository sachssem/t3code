import type { FileDiffMetadata } from "@pierre/diffs";
import { describe, expect, it } from "vite-plus/test";

import {
  getFileViewedRange,
  isFileDiffCollapsed,
  isLineInFileDiff,
  pullRequestFileFoldDefault,
  withFileDiffFold,
  type FileDiffFolds,
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
  const NO_FOLDS: FileDiffFolds = new Map();

  it("follows the default until the reader picks a file apart", () => {
    expect(isFileDiffCollapsed("a.ts", "expanded", NO_FOLDS)).toBe(false);
    expect(isFileDiffCollapsed("a.ts", "folded", NO_FOLDS)).toBe(true);
  });

  it("keeps the reader's own fold whatever the default says", () => {
    const folds = new Map([
      ["a.ts", true],
      ["b.ts", false],
    ]);
    expect(isFileDiffCollapsed("a.ts", "expanded", folds)).toBe(true);
    expect(isFileDiffCollapsed("b.ts", "folded", folds)).toBe(false);
    expect(isFileDiffCollapsed("c.ts", "expanded", folds)).toBe(false);
  });
});

describe("withFileDiffFold", () => {
  it("records the fold for one file only", () => {
    const folds = withFileDiffFold(new Map([["b.ts", true]]), "a.ts", false);
    expect([...folds]).toEqual([
      ["b.ts", true],
      ["a.ts", false],
    ]);
  });

  it("keeps its identity when the file already says so", () => {
    const folds: FileDiffFolds = new Map([["a.ts", true]]);
    expect(withFileDiffFold(folds, "a.ts", true)).toBe(folds);
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
describe("folding a file by ticking it off", () => {
  const path = "src/a.ts";
  const NO_PATHS: ReadonlySet<string> = new Set();
  const foldDefault = (reviewedPaths: ReadonlySet<string>) =>
    pullRequestFileFoldDefault(path, null, "expanded", {
      pathPatterns: [],
      reviewedPaths,
      generatedPaths: NO_PATHS,
      generatedFiles: true,
    });

  it.each([
    { collapseReviewed: true, label: "with reviewed files collapsing" },
    { collapseReviewed: false, label: "without reviewed files collapsing" },
  ])("folds on the tick and opens on the untick, $label", ({ collapseReviewed }) => {
    // Opened with nothing reviewed yet.
    let folds: FileDiffFolds = new Map();
    expect(isFileDiffCollapsed(path, foldDefault(NO_PATHS), folds)).toBe(false);

    folds = withFileDiffFold(folds, path, true);
    // The files reviewed at open can be captured only after the tick, from the read the tick's
    // own write set off, and by then they include this file.
    const reviewedAtOpen = collapseReviewed ? new Set([path]) : NO_PATHS;
    expect(isFileDiffCollapsed(path, foldDefault(NO_PATHS), folds)).toBe(true);
    expect(isFileDiffCollapsed(path, foldDefault(reviewedAtOpen), folds)).toBe(true);

    folds = withFileDiffFold(folds, path, false);
    expect(isFileDiffCollapsed(path, foldDefault(reviewedAtOpen), folds)).toBe(false);
  });

  it("still starts a file reviewed at open folded, and lets the reader open it", () => {
    const reviewedAtOpen = new Set([path]);
    expect(isFileDiffCollapsed(path, foldDefault(reviewedAtOpen), new Map())).toBe(true);
    const opened = withFileDiffFold(new Map(), path, false);
    expect(isFileDiffCollapsed(path, foldDefault(reviewedAtOpen), opened)).toBe(false);
  });
});

describe("pullRequestFileFoldDefault", () => {
  const reviewedPaths = new Set(["src/reviewed.ts"]);
  const generatedPaths = new Set(["src/paraglide/messages/en.js"]);
  const rules = {
    generatedFiles: true,
    pathPatterns: [/\.test\.ts$/],
    reviewedPaths,
    generatedPaths,
  };

  it("folds tests and files reviewed at open, and leaves the rest to the saved default", () => {
    expect(pullRequestFileFoldDefault("src/a.test.ts", null, "expanded", rules)).toBe("folded");
    expect(pullRequestFileFoldDefault("src/reviewed.ts", null, "expanded", rules)).toBe("folded");
    expect(pullRequestFileFoldDefault("src/other.ts", null, "expanded", rules)).toBe("expanded");
    expect(pullRequestFileFoldDefault("src/other.ts", null, "folded", rules)).toBe("folded");
  });

  it("leaves tests to the saved default once no pattern matches them", () => {
    const noTests = { generatedFiles: true, pathPatterns: [], reviewedPaths, generatedPaths };
    expect(pullRequestFileFoldDefault("src/a.test.ts", null, "expanded", noTests)).toBe("expanded");
  });

  it("lets the toolbar speak for every file", () => {
    expect(pullRequestFileFoldDefault("src/a.test.ts", "expanded", "folded", rules)).toBe(
      "expanded",
    );
    expect(pullRequestFileFoldDefault("src/reviewed.ts", "expanded", "folded", rules)).toBe(
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
    reviewedPaths: new Set<string>(),
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
