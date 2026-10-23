import { classifyChangedFile } from "@t3tools/shared/changedFileKind";

export function areAllDiffFilesCollapsed(
  fileKeys: ReadonlyArray<string>,
  collapsedFileKeys: ReadonlySet<string>,
): boolean {
  return fileKeys.length > 0 && fileKeys.every((fileKey) => collapsedFileKeys.has(fileKey));
}

/** Expands or collapses all of `fileKeys`; every other file, such as a hidden one, keeps its fold. */
export function toggleAllDiffFiles(
  fileKeys: ReadonlyArray<string>,
  collapsedFileKeys: ReadonlySet<string>,
): ReadonlySet<string> {
  const collapse = !areAllDiffFilesCollapsed(fileKeys, collapsedFileKeys);
  const next = new Set(collapsedFileKeys);
  for (const fileKey of fileKeys) {
    if (collapse) next.add(fileKey);
    else next.delete(fileKey);
  }
  return next;
}

export function isGeneratedDiffFile(path: string, generatedPaths: ReadonlySet<string>): boolean {
  return generatedPaths.has(path) || classifyChangedFile(path) === "generated";
}

export function initialCollapsedDiffFileKeys(
  files: ReadonlyArray<{ readonly fileKey: string; readonly path: string }>,
  rules: {
    readonly allCollapsed: boolean;
    readonly generatedFiles: boolean;
    readonly generatedPaths: ReadonlySet<string>;
  },
): ReadonlySet<string> {
  return new Set(
    files.flatMap((file) =>
      rules.allCollapsed ||
      (rules.generatedFiles && isGeneratedDiffFile(file.path, rules.generatedPaths))
        ? [file.fileKey]
        : [],
    ),
  );
}
