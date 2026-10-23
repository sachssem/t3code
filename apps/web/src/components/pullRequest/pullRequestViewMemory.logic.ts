export interface PullRequestCodeScrollAnchor {
  readonly itemId: string;
  readonly offset: number;
  readonly scrollTop: number;
}

export interface PullRequestViewState {
  readonly commitOid?: string | null;
  readonly scrollTops?: Partial<Record<"summary" | "timeline", number>>;
  readonly code?: Readonly<Record<string, PullRequestCodeScrollAnchor>>;
}

export interface PullRequestViewMemory {
  read: () => PullRequestViewState | undefined;
  update: (patch: PullRequestViewState) => void;
}

export function mergePullRequestViewState(
  previous: PullRequestViewState,
  patch: PullRequestViewState,
): PullRequestViewState {
  return {
    ...previous,
    ...patch,
    ...(patch.scrollTops ? { scrollTops: { ...previous.scrollTops, ...patch.scrollTops } } : {}),
    ...(patch.code
      ? {
          code: Object.fromEntries(
            [
              ...Object.entries(previous.code ?? {}).filter(([key]) => !(key in patch.code!)),
              ...Object.entries(patch.code),
            ].slice(-20),
          ),
        }
      : {}),
  };
}

// Hosts can return only the newest hundred commits. An absent commit must never trap the
// reader in a diff whose scope cannot be selected or cleared from the loaded list.
export function resolveCodeCommit(
  oid: string | null,
  commits: ReadonlyArray<{ readonly oid: string }> | undefined,
): string | null {
  return oid !== null && (commits === undefined || commits.some((commit) => commit.oid === oid))
    ? oid
    : null;
}

export function createScrollMemoryWriter(write: (patch: PullRequestViewState) => void) {
  let pending: PullRequestViewState | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const flush = () => {
    clearTimeout(timer);
    timer = undefined;
    if (pending === null) return;
    const patch = pending;
    pending = null;
    write(patch);
  };
  return {
    schedule: (patch: PullRequestViewState) => {
      pending = mergePullRequestViewState(pending ?? {}, patch);
      clearTimeout(timer);
      timer = setTimeout(flush, 500);
    },
    flush,
  };
}

/**
 * The file covering the top of the viewport, from every file in diff order. `topOf` is a file's
 * offset in the scroll content, which is also where the viewer's item scroll target measures
 * from. Not just the rendered files: the viewer reports a scroll before it re-renders, so after a
 * jump those are still the ones around the old position.
 */
export function findCodeScrollAnchor(
  scrollTop: number,
  files: ReadonlyArray<{ readonly id: string }>,
  topOf: (id: string) => number | undefined,
): { readonly itemId: string; readonly offset: number } | null {
  let covering: { readonly itemId: string; readonly offset: number } | null = null;
  for (const file of files) {
    const top = topOf(file.id);
    if (top === undefined) continue;
    if (top > scrollTop) break;
    covering = { itemId: file.id, offset: scrollTop - top };
  }
  return covering;
}

/**
 * How to get back to an anchor. While its file has not loaded, scroll to the old offset, which
 * also pulls in the pages before it, and try again; once there is nothing left to load, the
 * offset is the best there is. A file that came back shorter (folded, say) clamps the offset so
 * the reader still lands on it.
 */
export function resolveCodeScrollRestore(
  anchor: PullRequestCodeScrollAnchor,
  file: { readonly loaded: boolean; readonly height?: number | undefined },
  allPagesLoaded: boolean,
):
  | {
      readonly target: { readonly type: "item"; readonly id: string; readonly offset: number };
      readonly done: true;
    }
  | {
      readonly target: { readonly type: "position"; readonly position: number };
      readonly done: boolean;
    } {
  if (anchor.scrollTop === 0) return { target: { type: "position", position: 0 }, done: true };
  if (!file.loaded) {
    return { target: { type: "position", position: anchor.scrollTop }, done: allPagesLoaded };
  }
  const offset =
    file.height === undefined
      ? anchor.offset
      : Math.min(anchor.offset, Math.max(0, file.height - 1));
  // The viewer's item target puts the file `-offset` below the viewport's top.
  return { target: { type: "item", id: anchor.itemId, offset: -Math.max(0, offset) }, done: true };
}

/** Whether the viewport already sits where a restore's target puts it, to the pixel. */
export function isAtCodeScrollTarget(
  current: { readonly itemId: string; readonly offset: number } | null,
  target: ReturnType<typeof resolveCodeScrollRestore>["target"],
): boolean {
  return (
    target.type === "item" &&
    current !== null &&
    current.itemId === target.id &&
    // The target's offset is negative: the file sits that far above the viewport's top.
    Math.abs(current.offset + target.offset) <= 1
  );
}

export function scheduleCodeScrollRestorePage(
  anchor: PullRequestCodeScrollAnchor | undefined,
  files: ReadonlyArray<{ readonly id: string }>,
  canLoadNext: boolean,
  loadNext: () => void,
) {
  let cancelled = false;
  if (
    anchor !== undefined &&
    anchor.scrollTop > 0 &&
    canLoadNext &&
    !files.some((file) => file.id === anchor.itemId)
  ) {
    queueMicrotask(() => {
      if (!cancelled) loadNext();
    });
  }
  return () => {
    cancelled = true;
  };
}
