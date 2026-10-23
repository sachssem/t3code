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
