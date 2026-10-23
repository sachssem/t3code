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

/** The reader's own fold choice per file. It is absolute, so a Viewed mark loading later keeps it. */
export type FileDiffFoldChoices = ReadonlyMap<string, boolean>;

/**
 * A reader's own choice wins. Otherwise the toolbar decides, and a file still marked Viewed
 * starts folded. Fold all and Expand all clear the choices, so later pages follow the toolbar.
 */
export function isFileDiffCollapsed(
  fileKey: string,
  foldOverride: DiffFoldOverride,
  choices: FileDiffFoldChoices,
  viewed = false,
): boolean {
  return choices.get(fileKey) ?? (foldOverride === "folded" || viewed);
}

export function withFileDiffFold(
  choices: FileDiffFoldChoices,
  fileKey: string,
  collapsed: boolean,
): FileDiffFoldChoices {
  if (choices.get(fileKey) === collapsed) return choices;
  return new Map(choices).set(fileKey, collapsed);
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
