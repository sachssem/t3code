import {
  MAX_FILES_VIEWED_PRESSES,
  type PullRequestFileViewedState,
  type PullRequestFilesViewedResult,
} from "@t3tools/contracts";

export type FileViewedStates = ReadonlyMap<string, PullRequestFileViewedState>;

export type FileViewedOverlay = ReadonlyMap<string, boolean>;

export function toFileViewedStates(
  result: PullRequestFilesViewedResult | null,
): FileViewedStates | null {
  if (result === null) return null;
  return new Map(result.files.map((file) => [file.path, file.state]));
}

function isViewedState(state: PullRequestFileViewedState | undefined): boolean {
  return state === "viewed";
}

export function isStaleViewedState(state: PullRequestFileViewedState | undefined): boolean {
  return state === "dismissed";
}

export function isFileViewed(
  path: string,
  states: FileViewedStates | null,
  overlay: FileViewedOverlay,
): boolean {
  const pressed = overlay.get(path);
  return pressed ?? isViewedState(states?.get(path));
}

/** Retain presses until a read could have observed the write. */
export function settleFileViewedOverlay(
  overlay: FileViewedOverlay,
  states: FileViewedStates | null,
  pending: ReadonlySet<string>,
  answered: ReadonlySet<string>,
): FileViewedOverlay {
  if (states === null || overlay.size === 0) return overlay;
  const next = new Map(overlay);
  for (const [path, pressed] of overlay) {
    if (pending.has(path)) continue;
    if (answered.has(path) || isViewedState(states.get(path)) === pressed) next.delete(path);
  }
  return next.size === overlay.size ? overlay : next;
}

/** Revert only owned paths; later presses belong to other requests. */
export function revertFileViewedOverlay(
  overlay: FileViewedOverlay,
  batch: ReadonlyArray<{ readonly path: string; readonly viewed: boolean }>,
  owned: ReadonlySet<string>,
): FileViewedOverlay {
  const next = new Map(overlay);
  for (const { path, viewed } of batch) {
    if (!owned.has(path)) continue;
    if (next.get(path) === viewed) next.delete(path);
  }
  return next.size === overlay.size ? overlay : next;
}

function toFileViewedBatch(
  overlay: FileViewedOverlay,
): ReadonlyArray<{ readonly path: string; readonly viewed: boolean }> {
  return [...overlay].map(([path, viewed]) => ({ path, viewed }));
}

// Partial counts would report progress the reader has not made.
export function countUnreviewedLines(
  result: PullRequestFilesViewedResult | null,
  overlay: FileViewedOverlay,
): { readonly additions: number; readonly deletions: number } | null {
  if (result === null || result.truncated) return null;
  let additions = 0;
  let deletions = 0;
  for (const file of result.files) {
    if (file.additions === undefined || file.deletions === undefined) return null;
    if (overlay.get(file.path) ?? isViewedState(file.state)) continue;
    additions += file.additions;
    deletions += file.deletions;
  }
  return { additions, deletions };
}

/**
 * Every file currently counted as seen, the reader's presses included, or null before the host
 * has answered at all. A file pushed to since it was cleared is not among them.
 */
export function viewedFilePaths(
  states: FileViewedStates | null,
  overlay: FileViewedOverlay,
): ReadonlySet<string> | null {
  if (states === null) return null;
  const paths = new Set<string>();
  for (const [path, state] of states) if (isViewedState(state)) paths.add(path);
  for (const [path, pressed] of overlay) {
    if (pressed) paths.add(path);
    else paths.delete(path);
  }
  return paths;
}

/**
 * Client memory survives reloads. Explicit unmarks stay unmarked; a push dismissing a
 * viewed file permits one new mark until the host acknowledges it as viewed again.
 */
export interface AutoCollapsedFilesViewedMemory {
  readonly touched: Set<string>;
  readonly remarked: Set<string>;
}

/**
 * The auto-collapsed files to mark viewed now, recording them in `memory`. Nothing before the host has
 * answered, nothing the reader is pressing, and never a file the reader unticked after it was
 * marked. A write that fails leaves the memory as it is, so it is not retried into a loop.
 */
export function takeAutoCollapsedFilesToMarkViewed(
  paths: Iterable<string>,
  states: FileViewedStates | null,
  overlay: FileViewedOverlay,
  memory: AutoCollapsedFilesViewedMemory,
  truncated = false,
): ReadonlyArray<string> {
  if (states === null) return [];
  const marks: string[] = [];
  for (const path of paths) {
    if (overlay.has(path) || (!truncated && !states.has(path))) continue;
    const state = states.get(path);
    if (isViewedState(state)) {
      memory.touched.add(path);
      memory.remarked.delete(path);
      continue;
    }
    if (isStaleViewedState(state) ? memory.remarked.has(path) : memory.touched.has(path)) continue;
    memory.touched.add(path);
    if (isStaleViewedState(state)) memory.remarked.add(path);
    marks.push(path);
  }
  return marks;
}

export function toFileViewedBatches(
  overlay: FileViewedOverlay,
  automatic: FileViewedOverlay = new Map(),
) {
  // Unknown paths from a truncated host list can reject an entire request. Keep those
  // automatic marks separate so their failure cannot roll back the reader's presses.
  return [overlay, new Map([...automatic].filter(([path]) => !overlay.has(path)))].flatMap(
    (presses) => {
      const batch = toFileViewedBatch(presses);
      return Array.from(
        { length: Math.ceil(batch.length / MAX_FILES_VIEWED_PRESSES) },
        (_, index) =>
          batch.slice(index * MAX_FILES_VIEWED_PRESSES, (index + 1) * MAX_FILES_VIEWED_PRESSES),
      );
    },
  );
}

export function retainViewedAtOpen(previous: ReadonlySet<string>, viewed: ReadonlySet<string>) {
  const next = new Set([...previous].filter((path) => viewed.has(path)));
  return next.size === previous.size ? previous : next;
}
