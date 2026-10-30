import { parseScopedThreadKey, scopedThreadKey } from "@t3tools/client-runtime/environment";
import type { ScopedThreadRef } from "@t3tools/contracts";
import type { MouseEvent } from "react";

import { useRightPanelStore } from "../../rightPanelStore";

// The root carries its thread key, so keyboard history resolves the same ref the panel renders with.
const FILE_VIEWER_ROOT_ATTRIBUTE = "data-file-viewer-thread";

const MOUSE_BUTTON_BACK = 3;
const MOUSE_BUTTON_FORWARD = 4;

// Chromium turns unhandled thumb buttons into router history, which switches threads.
const suppressNavigationButton = (event: MouseEvent): boolean => {
  if (event.button !== MOUSE_BUTTON_BACK && event.button !== MOUSE_BUTTON_FORWARD) return false;
  event.preventDefault();
  event.stopPropagation();
  return true;
};

export function fileViewerHistoryRootProps(threadRef: ScopedThreadRef) {
  return {
    [FILE_VIEWER_ROOT_ATTRIBUTE]: scopedThreadKey(threadRef),
    tabIndex: -1,
    style: { outline: "none" },
    onMouseDown: suppressNavigationButton,
    onAuxClick: suppressNavigationButton,
    onMouseUp: (event: MouseEvent) => {
      if (!suppressNavigationButton(event)) return;
      const store = useRightPanelStore.getState();
      if (event.button === MOUSE_BUTTON_BACK) store.fileHistoryBack(threadRef);
      else store.fileHistoryForward(threadRef);
    },
  };
}

/** The thread whose file viewer holds focus; a shadow host counts as inside. */
export function focusedFileViewerThreadRef(): ScopedThreadRef | null {
  const activeElement = document.activeElement;
  if (!(activeElement instanceof HTMLElement) || !activeElement.isConnected) return null;
  const threadKey = activeElement
    .closest(`[${FILE_VIEWER_ROOT_ATTRIBUTE}]`)
    ?.getAttribute(FILE_VIEWER_ROOT_ATTRIBUTE);
  return threadKey ? parseScopedThreadKey(threadKey) : null;
}

export function restoreFileViewerFocus(threadRef: ScopedThreadRef): void {
  requestAnimationFrame(() => {
    if (focusedFileViewerThreadRef() !== null) return;
    const threadKey = scopedThreadKey(threadRef);
    const root = Array.from(
      document.querySelectorAll<HTMLElement>(`[${FILE_VIEWER_ROOT_ATTRIBUTE}]`),
    ).find((element) => element.getAttribute(FILE_VIEWER_ROOT_ATTRIBUTE) === threadKey);
    root?.focus({ preventScroll: true });
  });
}
