import { describe, expect, it, vi } from "vite-plus/test";
import {
  findCodeScrollAnchor,
  mergePullRequestViewState,
  scheduleCodeScrollRestorePage,
  isAtCodeScrollTarget,
  resolveCodeScrollRestore,
  resolveCodeCommit,
  createScrollMemoryWriter,
} from "./pullRequestViewMemory.logic";

describe("resolveCodeCommit", () => {
  it("restores only commits present in the loaded list", () => {
    expect(resolveCodeCommit("c1", undefined)).toBe("c1");
    expect(resolveCodeCommit("c1", [])).toBeNull();
    expect(resolveCodeCommit("c1", [{ oid: "c1" }])).toBe("c1");
    expect(resolveCodeCommit(null, [{ oid: "c1" }])).toBeNull();
    expect(
      resolveCodeCommit(
        "old",
        Array.from({ length: 100 }, (_, i) => ({ oid: String(i) })),
      ),
    ).toBeNull();
  });
});

describe("scroll memory writes", () => {
  it("coalesces scrolling and flushes the latest anchor when leaving", () => {
    vi.useFakeTimers();
    try {
      const write = vi.fn();
      const writer = createScrollMemoryWriter(write);
      writer.schedule({ scrollTops: { summary: 20 } });
      writer.schedule({ scrollTops: { timeline: 30 } });
      writer.schedule({ scrollTops: { summary: 40 } });
      expect(write).not.toHaveBeenCalled();
      vi.advanceTimersByTime(500);
      expect(write).toHaveBeenCalledExactlyOnceWith({ scrollTops: { summary: 40, timeline: 30 } });
      writer.schedule({ code: { all: { itemId: "deep.ts", offset: 10, scrollTop: 9000 } } });
      writer.flush();
      expect(write).toHaveBeenCalledTimes(2);
      expect(write.mock.lastCall?.[0]).toEqual({
        code: { all: { itemId: "deep.ts", offset: 10, scrollTop: 9000 } },
      });
      vi.runAllTimers();
      expect(write).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("findCodeScrollAnchor", () => {
  const tops = new Map([
    ["a.ts", 8],
    ["b.ts", 508],
    ["c.ts", 1208],
  ]);
  const files = [{ id: "a.ts" }, { id: "b.ts" }, { id: "c.ts" }];
  const topOf = (id: string) => tops.get(id);

  it("anchors to the file covering the viewport's top and the distance into it", () => {
    expect(findCodeScrollAnchor(700, files, topOf)).toEqual({ itemId: "b.ts", offset: 192 });
  });

  it("records deep jumps using files outside the old rendered window", () => {
    const files = Array.from({ length: 1000 }, (_, index) => ({ id: `${index}.ts` }));
    const topOf = (id: string) => 80 + Number.parseInt(id) * 500;
    expect(findCodeScrollAnchor(450123, files, topOf)).toEqual({ itemId: "900.ts", offset: 43 });
  });

  it("ignores files without a measured position", () => {
    expect(
      findCodeScrollAnchor(700, files, (id) => (id === "b.ts" ? undefined : topOf(id))),
    ).toEqual({ itemId: "a.ts", offset: 692 });
  });

  it("anchors to the first file above it", () => {
    expect(findCodeScrollAnchor(0, files, topOf)).toBeNull();
    expect(findCodeScrollAnchor(8, files, topOf)).toEqual({ itemId: "a.ts", offset: 0 });
  });
});

describe("resolveCodeScrollRestore", () => {
  const anchor = { itemId: "b.ts", offset: 200, scrollTop: 700 };

  it("returns to the top after the reader scrolls back above the first file", () => {
    expect(
      resolveCodeScrollRestore({ itemId: "a.ts", offset: 0, scrollTop: 0 }, { loaded: true }, true),
    ).toEqual({ target: { type: "position", position: 0 }, done: true });
  });

  it("returns to the file once it has loaded", () => {
    expect(resolveCodeScrollRestore(anchor, { loaded: true }, false)).toEqual({
      target: { type: "item", id: "b.ts", offset: -200 },
      done: true,
    });
  });

  it("keeps the reader on a file that came back shorter", () => {
    expect(resolveCodeScrollRestore(anchor, { loaded: true, height: 41 }, false).target).toEqual({
      type: "item",
      id: "b.ts",
      offset: -40,
    });
  });

  it("scrolls toward the old offset until the file's page arrives", () => {
    expect(resolveCodeScrollRestore(anchor, { loaded: false }, false)).toEqual({
      target: { type: "position", position: 700 },
      done: false,
    });
    expect(resolveCodeScrollRestore(anchor, { loaded: false }, true).done).toBe(true);
  });
});

describe("isAtCodeScrollTarget", () => {
  const target = { type: "item", id: "b.ts", offset: -200 } as const;

  it("holds only on the target file at the target depth", () => {
    expect(isAtCodeScrollTarget({ itemId: "b.ts", offset: 200.5 }, target)).toBe(true);
    expect(isAtCodeScrollTarget({ itemId: "b.ts", offset: 120 }, target)).toBe(false);
    expect(isAtCodeScrollTarget({ itemId: "a.ts", offset: 200 }, target)).toBe(false);
    expect(isAtCodeScrollTarget(null, target)).toBe(false);
    expect(
      isAtCodeScrollTarget({ itemId: "b.ts", offset: 200 }, { type: "position", position: 700 }),
    ).toBe(false);
  });
});

it("waits for scroll idle rather than writing throughout a continuous scroll", () => {
  vi.useFakeTimers();
  try {
    const write = vi.fn();
    const writer = createScrollMemoryWriter(write);
    writer.schedule({ scrollTops: { summary: 1 } });
    vi.advanceTimersByTime(400);
    writer.schedule({ scrollTops: { summary: 2 } });
    vi.advanceTimersByTime(400);
    writer.schedule({ scrollTops: { summary: 3 } });
    vi.advanceTimersByTime(499);
    expect(write).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(write).toHaveBeenCalledExactlyOnceWith({ scrollTops: { summary: 3 } });
  } finally {
    vi.useRealTimers();
  }
});

it("keeps only the 20 most recently written code scopes per PR", () => {
  const anchor = { itemId: "a.ts", offset: 0, scrollTop: 1 };
  const previous = {
    code: Object.fromEntries(Array.from({ length: 20 }, (_, index) => [`scope-${index}`, anchor])),
  };
  const touched = mergePullRequestViewState(previous, { code: { "scope-0": anchor } });
  const next = mergePullRequestViewState(touched, { code: { new: anchor } });
  expect(Object.keys(next.code!)).toHaveLength(20);
  expect(next.code!["scope-0"]).toEqual(anchor);
  expect(next.code!["scope-1"]).toBeUndefined();
  expect(next.code!["new"]).toEqual(anchor);
});

it("advances a deep restore after the commit and cancels an abandoned page", async () => {
  const anchor = { itemId: "deep.ts", offset: 0, scrollTop: 9000 };
  const loadNext = vi.fn();
  const cancel = scheduleCodeScrollRestorePage(anchor, [], true, loadNext);
  expect(loadNext).not.toHaveBeenCalled();
  cancel();
  await Promise.resolve();
  expect(loadNext).not.toHaveBeenCalled();
  scheduleCodeScrollRestorePage(anchor, [], true, loadNext);
  expect(loadNext).not.toHaveBeenCalled();
  await Promise.resolve();
  expect(loadNext).toHaveBeenCalledTimes(1);
  scheduleCodeScrollRestorePage(anchor, [{ id: "deep.ts" }], true, loadNext);
  scheduleCodeScrollRestorePage(anchor, [], false, loadNext);
  await Promise.resolve();
  expect(loadNext).toHaveBeenCalledTimes(1);
});
