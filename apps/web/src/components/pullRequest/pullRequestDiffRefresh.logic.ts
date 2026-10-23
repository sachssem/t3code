import type { PullRequestDiffResult } from "@t3tools/contracts";

// Follow the refreshed cursors because a push can change page boundaries.
export async function refreshLoadedDiffPages(
  count: number,
  read: (cursor: string | null) => Promise<PullRequestDiffResult | null>,
) {
  const pages: Array<PullRequestDiffResult & { readonly cursor: string | null }> = [];
  let cursor: string | null = null;
  do {
    const page = await read(cursor);
    if (page === null) return null;
    pages.push({ ...page, cursor });
    cursor = page.nextCursor;
  } while (cursor !== null && pages.length < count);
  return pages;
}
