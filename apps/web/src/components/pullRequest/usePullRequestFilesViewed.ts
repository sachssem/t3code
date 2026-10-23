import type { EnvironmentId, PullRequestRef } from "@t3tools/contracts";
import { useEffect, useSyncExternalStore } from "react";

import { pullRequestEnvironment } from "~/state/pullRequests";
import { useEnvironmentQuery } from "~/state/query";

import { filesViewedScope } from "./filesViewedStore";
import {
  countUnreviewedLines,
  viewedFilePaths,
  isFileViewed,
  isStaleViewedState,
  toFileViewedStates,
} from "./pullRequestFilesViewed.logic";

export interface PullRequestFilesViewedView {
  readonly enabled: boolean;
  readonly viewedPaths: ReadonlySet<string> | null;
  readonly isViewed: (path: string) => boolean;
  readonly isStale: (path: string) => boolean;
  readonly setViewed: (path: string, viewed: boolean) => void;
  readonly unreviewedLines: { readonly additions: number; readonly deletions: number } | null;
  readonly truncated: boolean;
  readonly error: string | null;
  readonly refresh: () => void;
}

const NO_OVERLAY = new Map<string, boolean>();
// Without this a change request that cannot record views would still be handed a scope handle.
const DISABLED_SCOPE = {
  subscribe: () => () => {},
  getSnapshot: () => NO_OVERLAY,
  setViewed: () => {},
  markViewed: (_paths: ReadonlyArray<string>) => {},
};

export function usePullRequestFilesViewed(options: {
  readonly environmentId: EnvironmentId;
  readonly reference: PullRequestRef;
  readonly enabled: boolean;
  readonly markViewedPaths?: ReadonlyArray<string>;
}): PullRequestFilesViewedView {
  const { environmentId, reference, enabled } = options;
  const query = useEnvironmentQuery(
    enabled ? pullRequestEnvironment.filesViewed({ environmentId, input: reference }) : null,
  );
  const states = toFileViewedStates(query.data);
  // Stable per scope: `setViewed` is handed to every file header the viewer draws.
  const scope = enabled ? filesViewedScope({ environmentId, reference }) : DISABLED_SCOPE;
  const overlay = useSyncExternalStore(scope.subscribe, scope.getSnapshot);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- queues automatic viewed marks in the shared external store after its host answer arrives
  useEffect(() => {
    if (query.data !== null && options.markViewedPaths !== undefined)
      scope.markViewed(options.markViewedPaths);
  }, [scope, options.markViewedPaths, query.data]);

  return {
    enabled,
    viewedPaths: viewedFilePaths(states, overlay),
    isViewed: (path: string) => isFileViewed(path, states, overlay),
    isStale: (path: string) => !overlay.has(path) && isStaleViewedState(states?.get(path)),
    setViewed: scope.setViewed,
    truncated: query.data?.truncated === true,
    error: query.error,
    refresh: query.refresh,
    unreviewedLines: countUnreviewedLines(query.data, overlay),
  };
}
