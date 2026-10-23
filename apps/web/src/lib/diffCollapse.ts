import { classifyChangedFile } from "@t3tools/shared/changedFileKind";

export function areAllDiffFilesCollapsed(
  fileKeys: ReadonlyArray<string>,
  collapsedFileKeys: ReadonlySet<string>,
): boolean {
  return fileKeys.length > 0 && fileKeys.every((fileKey) => collapsedFileKeys.has(fileKey));
}

export function toggleAllDiffFiles(
  fileKeys: ReadonlyArray<string>,
  collapsedFileKeys: ReadonlySet<string>,
): ReadonlySet<string> {
  return areAllDiffFilesCollapsed(fileKeys, collapsedFileKeys) ? new Set() : new Set(fileKeys);
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
