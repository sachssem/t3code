import { expect, it, vi } from "vite-plus/test";
import { refreshLoadedDiffPages } from "./pullRequestDiffRefresh.logic";

it("refreshes later loaded pages even when page one's patch is unchanged", async () => {
  const read = vi.fn(async (cursor: string | null) => ({
    patch: cursor === null ? "unchanged" : "new head hunks",
    truncated: false,
    nextCursor: cursor === null ? "new-page-two" : null,
  }));
  const pages = await refreshLoadedDiffPages(3, read);
  expect(read.mock.calls).toEqual([[null], ["new-page-two"]]);
  expect(pages?.map((page) => page.patch)).toEqual(["unchanged", "new head hunks"]);
});

it("keeps the mounted pages when a background page fails", async () => {
  expect(await refreshLoadedDiffPages(2, async () => null)).toBeNull();
});
