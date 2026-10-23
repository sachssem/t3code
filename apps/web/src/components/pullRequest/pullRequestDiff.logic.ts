import type { FileDiffMetadata } from "@pierre/diffs";
import type { DiffFoldOverride } from "@t3tools/client-runtime/pull-request-diff-fold";
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

// The toolbar also applies to files that have not arrived in a page yet.
export function pullRequestFileFoldDefault(
  path: string,
  foldOverride: DiffFoldOverride,
  savedDefault: "expanded" | "folded",
  rules: {
    readonly generatedFiles: boolean;
    readonly pathPatterns: ReadonlyArray<RegExp>;
    readonly generatedPaths: ReadonlySet<string>;
  },
): "expanded" | "folded" {
  if (foldOverride !== null) return foldOverride;
  if (matchesDiffCollapsePatterns(path, rules.pathPatterns)) return "folded";
  if (rules.generatedFiles && isGeneratedDiffFile(path, rules.generatedPaths)) return "folded";
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
