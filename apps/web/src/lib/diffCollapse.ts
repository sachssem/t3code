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
    readonly pathPatterns: ReadonlyArray<RegExp>;
    readonly generatedPaths: ReadonlySet<string>;
  },
): ReadonlySet<string> {
  return new Set(
    files.flatMap((file) =>
      rules.allCollapsed ||
      matchesDiffCollapsePatterns(file.path, rules.pathPatterns) ||
      (rules.generatedFiles && isGeneratedDiffFile(file.path, rules.generatedPaths))
        ? [file.fileKey]
        : [],
    ),
  );
}

/** The auto-collapse patterns as compiled once per settings change, and the entries that failed. */
interface CompiledDiffCollapsePatterns {
  readonly matchers: ReadonlyArray<RegExp>;
  readonly invalid: ReadonlyArray<string>;
}

/**
 * Compiles the saved path patterns. Blank lines are skipped and an entry that is not a valid
 * regular expression is set aside for the settings row to flag, never thrown.
 */
export function compileDiffCollapsePatterns(
  patterns: ReadonlyArray<string>,
): CompiledDiffCollapsePatterns {
  const matchers: RegExp[] = [];
  const invalid: string[] = [];
  for (const raw of patterns) {
    const pattern = raw.trim();
    if (pattern.length === 0) continue;
    try {
      matchers.push(new RegExp(pattern));
    } catch {
      invalid.push(pattern);
    }
  }
  return { matchers, invalid };
}

/** Whether a repo-relative path matches any of the auto-collapse patterns. */
export function matchesDiffCollapsePatterns(
  path: string,
  matchers: ReadonlyArray<RegExp>,
): boolean {
  return matchers.some((matcher) => matcher.test(path));
}
