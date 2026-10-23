import type { FileDiffMetadata } from "@pierre/diffs";
import type { PullRequestDiffSide } from "@t3tools/contracts";

import { isGeneratedDiffFile, matchesDiffCollapsePatterns } from "~/lib/diffCollapse";

/** Only rendered hunks can anchor comments; list others off-diff. */
export function isLineInFileDiff(
  file: FileDiffMetadata,
  side: PullRequestDiffSide,
  line: number,
): boolean {
  return file.hunks.some((hunk) =>
    side === "left"
      ? line >= hunk.deletionStart && line < hunk.deletionStart + hunk.deletionCount
      : line >= hunk.additionStart && line < hunk.additionStart + hunk.additionCount,
  );
}

/** What the toolbar last asked of every file at once, null being the reader asking nothing yet. */
export type DiffFoldOverride = "expanded" | "folded" | null;

// Absolute choices survive late reviewed-file answers and generated-file metadata.
export type FileDiffFolds = ReadonlyMap<string, boolean>;

export function isFileDiffCollapsed(
  fileKey: string,
  foldDefault: "expanded" | "folded",
  folds: FileDiffFolds,
): boolean {
  return folds.get(fileKey) ?? foldDefault === "folded";
}

export function withFileDiffFold(
  folds: FileDiffFolds,
  fileKey: string,
  collapsed: boolean,
): FileDiffFolds {
  if (folds.get(fileKey) === collapsed) return folds;
  return new Map(folds).set(fileKey, collapsed);
}

// The toolbar also applies to files that have not arrived in a page yet.
export function pullRequestFileFoldDefault(
  path: string,
  foldOverride: DiffFoldOverride,
  savedDefault: "expanded" | "folded",
  rules: {
    readonly generatedFiles: boolean;
    readonly pathPatterns: ReadonlyArray<RegExp>;
    readonly reviewedPaths: ReadonlySet<string>;
    readonly generatedPaths: ReadonlySet<string>;
  },
): "expanded" | "folded" {
  if (foldOverride !== null) return foldOverride;
  if (matchesDiffCollapsePatterns(path, rules.pathPatterns)) return "folded";
  if (rules.generatedFiles && isGeneratedDiffFile(path, rules.generatedPaths)) return "folded";
  if (rules.reviewedPaths.has(path)) return "folded";
  return savedDefault;
}

export function getFileViewedRange<T extends { readonly fileKey: string }>(
  files: ReadonlyArray<T>,
  fileKey: string,
  anchorFileKey: string | null,
): ReadonlyArray<T> {
  const index = files.findIndex((file) => file.fileKey === fileKey);
  if (index === -1) return [];
  const anchorIndex = files.findIndex((file) => file.fileKey === anchorFileKey);
  if (anchorIndex === -1) return files.slice(index, index + 1);
  return files.slice(Math.min(index, anchorIndex), Math.max(index, anchorIndex) + 1);
}
