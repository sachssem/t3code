import { expect, it, vi } from "vite-plus/test";
import { createAutoViewedMemoryStore } from "./pullRequestAutoViewedMemory.logic";
import { takeAutoCollapsedFilesToMarkViewed } from "./pullRequestFilesViewed.logic";

it("remembers explicit unmarks after a client reload and writes only changed sets", () => {
  let stored: Parameters<Parameters<typeof createAutoViewedMemoryStore>[1]>[0] = [];
  const write = vi.fn((entries: typeof stored) => {
    stored = entries;
  });
  const store = createAutoViewedMemoryStore(() => stored, write);
  store("env-a/pr-1", (memory) => {
    memory.touched.add("lock.json");
    memory.remarked.add("lock.json");
  });
  store("env-a/pr-1", (memory) => {
    memory.touched.add("lock.json");
    memory.remarked.add("lock.json");
  });
  expect(write).toHaveBeenCalledTimes(1);
  const reloaded = createAutoViewedMemoryStore(() => stored, write);
  reloaded("env-a/pr-1", (memory) => {
    expect(
      takeAutoCollapsedFilesToMarkViewed(
        ["lock.json"],
        new Map([["lock.json", "unviewed"]]),
        new Map(),
        memory,
      ),
    ).toEqual([]);
  });
  expect(write).toHaveBeenCalledTimes(1);
  reloaded("env-b/pr-1", (memory) => {
    expect(
      takeAutoCollapsedFilesToMarkViewed(
        ["lock.json"],
        new Map([["lock.json", "unviewed"]]),
        new Map(),
        memory,
      ),
    ).toEqual(["lock.json"]);
  });
  expect(write).toHaveBeenCalledTimes(2);
});

it("prunes memory to the 200 most recently changed PRs", () => {
  let stored: Parameters<Parameters<typeof createAutoViewedMemoryStore>[1]>[0] = [];
  const store = createAutoViewedMemoryStore(
    () => stored,
    (entries) => {
      stored = entries;
    },
  );
  for (let index = 0; index < 200; index++)
    store(String(index), (memory) => {
      memory.touched.add("a");
    });
  store("0", (memory) => {
    memory.touched.add("b");
  });
  store("200", (memory) => {
    memory.touched.add("a");
  });
  expect(stored).toHaveLength(200);
  expect(stored.some((entry) => entry.scope === "0")).toBe(true);
  expect(stored.some((entry) => entry.scope === "1")).toBe(false);
});
