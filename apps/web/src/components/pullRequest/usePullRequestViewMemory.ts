import { scopedThreadKey, scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { ScopedThreadRef } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { useEffect, useState } from "react";

import { getLocalStorageItem, setLocalStorageItem } from "~/hooks/useLocalStorage";
import { useRightPanelStore } from "~/rightPanelStore";
import {
  createScrollMemoryWriter,
  mergePullRequestViewState,
  type PullRequestViewMemory,
} from "./pullRequestViewMemory.logic";

const STORAGE_KEY = "t3code:pr-scroll-memory:v1";
const ScrollState = Schema.Struct({
  scrollTops: Schema.optionalKey(
    Schema.Struct({
      summary: Schema.optionalKey(Schema.Number),
      timeline: Schema.optionalKey(Schema.Number),
    }),
  ),
  code: Schema.optionalKey(
    Schema.Record(
      Schema.String,
      Schema.Struct({
        itemId: Schema.String,
        offset: Schema.Number,
        scrollTop: Schema.Number,
      }),
    ),
  ),
});
const ScrollMemories = Schema.Record(Schema.String, ScrollState);

function readScrollMemories() {
  try {
    return getLocalStorageItem(STORAGE_KEY, ScrollMemories) ?? {};
  } catch (error) {
    console.error("Could not read PR scroll memory.", error);
    return {};
  }
}

// Scroll anchors have no subscribers. Updating surfaces for them would rerender the reader
// and serialize the entire right panel store on every saved position.
export function getPullRequestViewMemory(
  threadRef: ScopedThreadRef,
  surfaceId: string,
  updateViewState = useRightPanelStore.getState().updatePullRequestViewState,
): PullRequestViewMemory {
  const key = JSON.stringify([scopedThreadKey(threadRef), surfaceId]);
  const entry = () =>
    useRightPanelStore
      .getState()
      .byThreadKey[scopedThreadKey(threadRef)]?.surfaces.find((entry) => entry.id === surfaceId);
  return {
    read: () => {
      const surface = entry();
      return mergePullRequestViewState(
        surface?.kind === "pull-request" ? (surface.viewState ?? {}) : {},
        readScrollMemories()[key] ?? {},
      );
    },
    update: (patch) => {
      if (entry()?.kind !== "pull-request") return;
      if (patch.commitOid !== undefined)
        updateViewState(threadRef, surfaceId, { commitOid: patch.commitOid });
      if (patch.code === undefined && patch.scrollTops === undefined) return;
      const previous = readScrollMemories();
      const next = mergePullRequestViewState(previous[key] ?? {}, {
        ...(patch.code === undefined ? {} : { code: patch.code }),
        ...(patch.scrollTops === undefined ? {} : { scrollTops: patch.scrollTops }),
      });
      const entries = [
        ...Object.entries(previous).filter(([scope]) => scope !== key),
        [key, next] as const,
      ].slice(-200);
      try {
        setLocalStorageItem(STORAGE_KEY, Object.fromEntries(entries), ScrollMemories);
      } catch (error) {
        console.error("Could not save PR scroll memory.", error);
      }
    },
  };
}

export function usePullRequestViewMemory(
  threadRef: ScopedThreadRef | null,
  surfaceId: string | undefined,
) {
  const updateViewState = useRightPanelStore((state) => state.updatePullRequestViewState);
  const environmentId = threadRef?.environmentId;
  const threadId = threadRef?.threadId;
  if (environmentId === undefined || threadId === undefined || surfaceId === undefined)
    return undefined;
  return getPullRequestViewMemory(
    scopeThreadRef(environmentId, threadId),
    surfaceId,
    updateViewState,
  );
}

export function usePullRequestScrollMemory(
  memory: PullRequestViewMemory | undefined,
  scopeKey: string,
) {
  const [state, setState] = useState(() => ({
    key: scopeKey,
    writer: createScrollMemoryWriter((patch) => memory?.update(patch)),
  }));
  if (state.key !== scopeKey)
    setState({ key: scopeKey, writer: createScrollMemoryWriter((patch) => memory?.update(patch)) });
  const writer = state.writer;
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- flushes stored scroll anchors when the page hides or the viewer unmounts
  useEffect(() => {
    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") writer.flush();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      writer.flush();
    };
  }, [writer]);
  return writer;
}
