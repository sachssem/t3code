import {
  MAX_FILES_VIEWED_PRESSES,
  PullRequestSetFilesViewedInput,
  ProjectId,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";

import {
  countUnreviewedLines,
  retainViewedAtOpen,
  toFileViewedBatches,
  viewedFilePaths,
  takeAutoCollapsedFilesToMarkViewed,
  isFileViewed,
  isStaleViewedState,
  revertFileViewedOverlay,
  settleFileViewedOverlay,
  toFileViewedStates,
  type FileViewedOverlay,
} from "./pullRequestFilesViewed.logic";

const decodeSetFilesViewed = Schema.decodeSync(PullRequestSetFilesViewedInput);

const NO_OVERLAY: FileViewedOverlay = new Map();
const NOTHING_PENDING: ReadonlySet<string> = new Set();
const NOTHING_ANSWERED: ReadonlySet<string> = new Set();

const states = toFileViewedStates({
  files: [
    { path: "a.ts", state: "viewed" },
    { path: "b.ts", state: "unviewed" },
    { path: "c.ts", state: "dismissed" },
  ],
  truncated: false,
});

describe("isFileViewed", () => {
  it("reads a file pushed to since it was cleared as unread", () => {
    expect(isFileViewed("c.ts", states, NO_OVERLAY)).toBe(false);
    expect(isStaleViewedState(states?.get("c.ts"))).toBe(true);
    expect(isStaleViewedState(states?.get("a.ts"))).toBe(false);
  });

  it("shows the press ahead of the host's answer", () => {
    expect(isFileViewed("b.ts", states, new Map([["b.ts", true]]))).toBe(true);
    expect(isFileViewed("a.ts", states, new Map([["a.ts", false]]))).toBe(false);
  });
});

describe("settleFileViewedOverlay", () => {
  it("drops a press the host has caught up on", () => {
    const settled = settleFileViewedOverlay(
      new Map([["a.ts", true]]),
      states,
      NOTHING_PENDING,
      NOTHING_ANSWERED,
    );
    expect(settled.size).toBe(0);
  });

  it("keeps a press the host cannot have heard yet", () => {
    const overlay = new Map([["a.ts", false]]);
    const settled = settleFileViewedOverlay(overlay, states, new Set(["a.ts"]), NOTHING_ANSWERED);
    expect(settled.get("a.ts")).toBe(false);
  });

  it("settles a file pushed to since it was cleared against un-ticking it", () => {
    const settled = settleFileViewedOverlay(
      new Map([["c.ts", false]]),
      states,
      NOTHING_PENDING,
      NOTHING_ANSWERED,
    );
    expect(settled.size).toBe(0);
  });

  it("drops a tick once a read has answered for it, against what the reader pressed", () => {
    const settled = settleFileViewedOverlay(
      new Map([["c.ts", true]]),
      states,
      NOTHING_PENDING,
      new Set(["c.ts"]),
    );
    expect(settled.size).toBe(0);
    expect(isFileViewed("c.ts", states, settled)).toBe(false);
    expect(isStaleViewedState(states?.get("c.ts"))).toBe(true);
  });

  it("holds a press made since the read that would otherwise answer for it", () => {
    const overlay = new Map([["c.ts", true]]);
    const settled = settleFileViewedOverlay(overlay, states, new Set(["c.ts"]), new Set(["c.ts"]));
    expect(settled.get("c.ts")).toBe(true);
  });
});

describe("revertFileViewedOverlay", () => {
  const batch = [
    { path: "a.ts", viewed: true },
    { path: "b.ts", viewed: false },
  ];
  const both = new Set(["a.ts", "b.ts"]);

  it("puts the checkbox back to the host's answer for everything the request answers for", () => {
    const overlay = new Map([
      ["a.ts", true],
      ["b.ts", false],
    ]);
    expect(revertFileViewedOverlay(overlay, batch, both).size).toBe(0);
  });

  it("leaves a press the reader made after the request went out", () => {
    const overlay = new Map([
      ["a.ts", false],
      ["b.ts", false],
    ]);
    const reverted = revertFileViewedOverlay(overlay, batch, new Set(["b.ts"]));
    expect([...reverted]).toEqual([["a.ts", false]]);
  });

  it("leaves a path a later request took over, even pressed the same way", () => {
    const overlay = new Map([["a.ts", true]]);
    expect(revertFileViewedOverlay(overlay, batch, new Set(["b.ts"]))).toBe(overlay);
  });
});

describe("countUnreviewedLines", () => {
  const result = {
    files: [
      { path: "a.ts", state: "viewed" as const, additions: 10, deletions: 1 },
      { path: "b.ts", state: "unviewed" as const, additions: 5, deletions: 2 },
      { path: "c.ts", state: "dismissed" as const, additions: 3, deletions: 4 },
    ],
    truncated: false,
  };

  it("counts unviewed files and files pushed to since they were cleared", () => {
    expect(countUnreviewedLines(result, NO_OVERLAY)).toEqual({ additions: 8, deletions: 6 });
  });

  it("follows the reader's presses ahead of the host", () => {
    const overlay = new Map([
      ["a.ts", false],
      ["b.ts", true],
    ]);
    expect(countUnreviewedLines(result, overlay)).toEqual({ additions: 13, deletions: 5 });
  });

  it("reaches zero once every file is cleared", () => {
    const overlay = new Map([
      ["b.ts", true],
      ["c.ts", true],
    ]);
    expect(countUnreviewedLines(result, overlay)).toEqual({ additions: 0, deletions: 0 });
  });

  it("says nothing when the host carries no counts or did not list every file", () => {
    expect(countUnreviewedLines(null, NO_OVERLAY)).toBeNull();
    expect(countUnreviewedLines({ ...result, truncated: true }, NO_OVERLAY)).toBeNull();
    expect(
      countUnreviewedLines(
        { files: [{ path: "a.ts", state: "unviewed" }], truncated: false },
        NO_OVERLAY,
      ),
    ).toBeNull();
  });
});

describe("viewedFilePaths", () => {
  it("lists cleared files, not stale ones, with the reader's presses on top", () => {
    expect(viewedFilePaths(null, NO_OVERLAY)).toBeNull();
    expect([...(viewedFilePaths(states, NO_OVERLAY) ?? [])]).toEqual(["a.ts"]);
    const overlay = new Map([
      ["a.ts", false],
      ["b.ts", true],
    ]);
    expect([...(viewedFilePaths(states, overlay) ?? [])]).toEqual(["b.ts"]);
  });
});

describe("takeAutoCollapsedFilesToMarkViewed", () => {
  const generated = ["a.ts", "b.ts", "c.ts", "d.ts"];
  const answer = (files: Record<string, "viewed" | "unviewed" | "dismissed">) =>
    toFileViewedStates({
      files: Object.entries(files).map(([path, state]) => ({ path, state })),
      truncated: false,
    });

  it("marks what is not viewed once, and waits for the host's first answer", () => {
    const memory = { touched: new Set<string>(), remarked: new Set<string>() };
    expect(takeAutoCollapsedFilesToMarkViewed(generated, null, NO_OVERLAY, memory)).toEqual([]);
    const pressing = new Map([["d.ts", false]]);
    expect(takeAutoCollapsedFilesToMarkViewed(generated, states, pressing, memory)).toEqual([
      "b.ts",
      "c.ts",
    ]);
    // The same answer again, or a failed write leaving it standing, marks nothing more.
    expect(takeAutoCollapsedFilesToMarkViewed(generated, states, pressing, memory)).toEqual([]);
  });

  it("leaves a file the reader unticked alone, and marks it again only after a push", () => {
    const memory = { touched: new Set<string>(), remarked: new Set<string>() };
    expect(
      takeAutoCollapsedFilesToMarkViewed(
        ["a.ts"],
        answer({ "a.ts": "unviewed" }),
        NO_OVERLAY,
        memory,
      ),
    ).toEqual(["a.ts"]);
    takeAutoCollapsedFilesToMarkViewed(["a.ts"], answer({ "a.ts": "viewed" }), NO_OVERLAY, memory);
    expect(
      takeAutoCollapsedFilesToMarkViewed(
        ["a.ts"],
        answer({ "a.ts": "unviewed" }),
        NO_OVERLAY,
        memory,
      ),
    ).toEqual([]);

    const pushed = { touched: new Set<string>(), remarked: new Set<string>() };
    const dismissed = answer({ "a.ts": "dismissed" });
    expect(takeAutoCollapsedFilesToMarkViewed(["a.ts"], dismissed, NO_OVERLAY, pushed)).toEqual([
      "a.ts",
    ]);
    expect(takeAutoCollapsedFilesToMarkViewed(["a.ts"], dismissed, NO_OVERLAY, pushed)).toEqual([]);
    takeAutoCollapsedFilesToMarkViewed(["a.ts"], answer({ "a.ts": "viewed" }), NO_OVERLAY, pushed);
    expect(takeAutoCollapsedFilesToMarkViewed(["a.ts"], dismissed, NO_OVERLAY, pushed)).toEqual([
      "a.ts",
    ]);
  });
});

it("leaves files already viewed at open unmarked after a manual unmark", () => {
  const memory = { touched: new Set<string>(), remarked: new Set<string>() };
  expect(takeAutoCollapsedFilesToMarkViewed(["a.ts"], states, NO_OVERLAY, memory)).toEqual([]);
  const unmarked = toFileViewedStates({
    files: [{ path: "a.ts", state: "unviewed" }],
    truncated: false,
  });
  expect(takeAutoCollapsedFilesToMarkViewed(["a.ts"], unmarked, NO_OVERLAY, memory)).toEqual([]);
});

it("sends every auto-view press within the viewed-files contract limit", () => {
  const overlay = new Map(
    Array.from(
      { length: MAX_FILES_VIEWED_PRESSES * 2 + 1 },
      (_, index) => [`src/${index}.ts`, index % 2 === 0] as const,
    ),
  );
  const batches = toFileViewedBatches(overlay);
  expect(batches).toHaveLength(3);
  for (const files of batches) {
    expect(() =>
      decodeSetFilesViewed({
        projectId: ProjectId.make("project"),
        repository: "acme/repo",
        number: 1,
        files,
      }),
    ).not.toThrow();
  }
  expect(batches.flat()).toEqual([...overlay].map(([path, viewed]) => ({ path, viewed })));
  expect(toFileViewedBatches(new Map())).toEqual([]);
});

it("removes automatic marks from lines left to review through the same overlay", () => {
  const result = {
    files: [
      { path: "pnpm-lock.yaml", state: "unviewed" as const, additions: 100, deletions: 50 },
      { path: "src/app.ts", state: "unviewed" as const, additions: 3, deletions: 1 },
    ],
    truncated: false,
  };
  const memory = { touched: new Set<string>(), remarked: new Set<string>() };
  const marks = takeAutoCollapsedFilesToMarkViewed(
    ["pnpm-lock.yaml"],
    toFileViewedStates(result),
    NO_OVERLAY,
    memory,
  );
  expect(countUnreviewedLines(result, new Map(marks.map((path) => [path, true])))).toEqual({
    additions: 3,
    deletions: 1,
  });
});

it("does not mark historical commit paths absent from a complete PR viewed list", () => {
  const memory = { touched: new Set<string>(), remarked: new Set<string>() };
  expect(
    takeAutoCollapsedFilesToMarkViewed(["deleted.ts", "b.ts"], states, NO_OVERLAY, memory),
  ).toEqual(["b.ts"]);
  expect(memory.touched.has("deleted.ts")).toBe(false);
  expect(
    takeAutoCollapsedFilesToMarkViewed(["deleted.ts"], states, NO_OVERLAY, memory, true),
  ).toEqual(["deleted.ts"]);
});

it("isolates automatic failures from user presses and lets the user's last press win", () => {
  const user = new Map([["mine.ts", false]]);
  const automatic = new Map([
    ["unknown.ts", true],
    ["mine.ts", true],
  ]);
  const batches = toFileViewedBatches(user, automatic);
  expect(batches).toEqual([
    [{ path: "mine.ts", viewed: false }],
    [{ path: "unknown.ts", viewed: true }],
  ]);
  const reverted = revertFileViewedOverlay(
    new Map([
      ["mine.ts", false],
      ["unknown.ts", true],
    ]),
    batches[1]!,
    new Set(["unknown.ts"]),
  );
  expect([...reverted]).toEqual([["mine.ts", false]]);
});

it("stops force-collapsing dismissed or unviewed paths without adding newly viewed paths", () => {
  const initial = new Set(["a.ts", "c.ts"]);
  const retained = retainViewedAtOpen(initial, viewedFilePaths(states, NO_OVERLAY)!);
  expect([...retained]).toEqual(["a.ts"]);
  const unmarked = retainViewedAtOpen(retained, new Set(["b.ts"]));
  expect(unmarked.size).toBe(0);
  expect(retainViewedAtOpen(unmarked, new Set(["a.ts"]))).toBe(unmarked);
});
