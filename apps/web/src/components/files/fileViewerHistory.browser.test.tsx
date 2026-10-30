import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { expect, it, vi } from "vite-plus/test";

import { render } from "../../../test/render";
import {
  fileViewerHistoryRootProps,
  focusedFileViewerThreadRef,
  restoreFileViewerFocus,
} from "./fileViewerHistory";

const threadRef = {
  environmentId: EnvironmentId.make("file-history"),
  threadId: ThreadId.make("thread"),
};

it.each(["replaced", "retained", "closed"] as const)(
  "keeps keyboard navigation in the viewer after its focused element is %s",
  async (state) => {
    const rootProps = fileViewerHistoryRootProps(threadRef);
    await using screen = await render(
      <div {...rootProps}>
        <button type="button">Original file</button>
      </div>,
      // Focus behavior does not depend on routing.
      { router: false },
    );
    using frame = vi.spyOn(window, "requestAnimationFrame").mockReturnValue(1);
    const original = screen.getByRole("button").element();
    original.focus();
    expect(focusedFileViewerThreadRef()).toEqual(threadRef);

    restoreFileViewerFocus(threadRef);
    if (state === "replaced") {
      await screen.rerender(
        <div {...rootProps}>
          <span>Next file</span>
        </div>,
      );
    } else if (state === "closed") {
      await screen.rerender(<div>Panel closed</div>);
    }

    const callback = frame.mock.calls[0]?.[0];
    callback?.(0);
    if (state === "closed") {
      expect(focusedFileViewerThreadRef()).toBeNull();
    } else {
      expect(focusedFileViewerThreadRef()).toEqual(threadRef);
      if (state === "retained") expect(document.activeElement).toBe(original);
      else
        expect(document.activeElement?.getAttribute("data-file-viewer-thread")).toBe(
          rootProps["data-file-viewer-thread"],
        );
    }
  },
);
