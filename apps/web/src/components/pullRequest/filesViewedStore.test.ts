import {
  EnvironmentId,
  MAX_FILES_VIEWED_PRESSES,
  ProjectId,
  type PullRequestFilesViewedResult,
  type PullRequestRef,
} from "@t3tools/contracts";
import { Cause } from "effect";
import { AsyncResult } from "effect/reactivity";
import { describe, expect, it, vi } from "vite-plus/test";

import {
  autoViewedMemoryScopeKey,
  createFilesViewedStore,
  type FilesViewedStoreDeps,
  type FilesViewedTarget,
} from "./filesViewedStore";

const reference = (number: number): PullRequestRef => ({
  projectId: ProjectId.make("project"),
  repository: "t3/code",
  number,
});

const first: FilesViewedTarget = {
  environmentId: EnvironmentId.make("files-viewed"),
  reference: reference(1),
};
const second: FilesViewedTarget = { ...first, reference: reference(2) };

const answer = (viewed: boolean): PullRequestFilesViewedResult => ({
  files: [{ path: "a.ts", state: viewed ? "viewed" : "unviewed" }],
  truncated: false,
});

function setup(initial: PullRequestFilesViewedResult | null = answer(false)) {
  vi.useFakeTimers();
  const answers = new Map<string, (answer: PullRequestFilesViewedResult | null) => void>();
  const settles: Array<(result: AsyncResult.AsyncResult<unknown, unknown>) => void> = [];
  const send = vi.fn<FilesViewedStoreDeps["send"]>(
    () =>
      new Promise((resolve) => {
        settles.push((result) => resolve(result as never));
      }),
  );
  const refresh = vi.fn();
  const reportFailure = vi.fn();
  const store = createFilesViewedStore({
    flushDelayMs: 400,
    subscribeAnswers: (target, onAnswer) => {
      const key = String(target.reference.number);
      answers.set(key, onAnswer);
      onAnswer(initial);
      return () => answers.delete(key);
    },
    send,
    refresh,
    reportFailure,
  });
  const answerFor = (target: FilesViewedTarget, next: PullRequestFilesViewedResult | null) =>
    answers.get(String(target.reference.number))?.(next);
  return {
    store,
    send,
    refresh,
    reportFailure,
    settles,
    answerFor,
    answers,
    [Symbol.dispose]: () => vi.useRealTimers(),
  };
}

describe("createFilesViewedStore", () => {
  it("batches presses and holds them until a read that could have seen them", async () => {
    using t = setup();
    const scope = t.store.scope(first);
    const release = scope.subscribe(() => {});
    scope.setViewed("a.ts", true);
    expect(scope.getSnapshot().get("a.ts")).toBe(true);
    await vi.advanceTimersByTimeAsync(400);
    expect(t.send).toHaveBeenCalledTimes(1);
    expect(t.send.mock.calls[0]?.[1]).toEqual([{ path: "a.ts", viewed: true }]);

    t.settles[0]?.(AsyncResult.success(undefined));
    await vi.advanceTimersByTimeAsync(0);
    expect(t.refresh).toHaveBeenCalledWith(first);
    expect(scope.getSnapshot().get("a.ts")).toBe(true);

    // A push landed between the write and the next read: the host's answer wins.
    t.answerFor(first, {
      files: [{ path: "a.ts", state: "dismissed" }],
      truncated: false,
    });
    expect(scope.getSnapshot().size).toBe(0);
    release();
  });

  it("puts a failed press back and reports it", async () => {
    using t = setup();
    const scope = t.store.scope(first);
    const release = scope.subscribe(() => {});
    scope.setViewed("a.ts", true);
    await vi.advanceTimersByTimeAsync(400);
    t.settles[0]?.(AsyncResult.failure(Cause.fail("nope")));
    await vi.advanceTimersByTimeAsync(0);
    expect(scope.getSnapshot().size).toBe(0);
    expect(t.reportFailure).toHaveBeenCalledTimes(1);
    expect(t.refresh).toHaveBeenCalledWith(first);
    release();
  });

  it("refreshes the answer for a press that lands after its scope was left", async () => {
    using t = setup();
    const left = t.store.scope(first);
    const release = left.subscribe(() => {});
    left.setViewed("a.ts", true);
    release();
    expect(t.send).toHaveBeenCalledTimes(1);

    t.settles[0]?.(AsyncResult.success(undefined));
    await vi.advanceTimersByTimeAsync(0);
    expect(t.refresh).toHaveBeenCalledWith(first);
  });

  it("forgets a scope's handle once its last reader leaves", () => {
    using t = setup();
    const handle = t.store.scope(first);
    const release = handle.subscribe(() => {});
    expect(t.store.scope(first)).toBe(handle);
    release();
    expect(t.store.scope(first)).not.toBe(handle);
  });

  it("keeps the handle and the debounce across a release and re-subscribe through it", async () => {
    using t = setup();
    const handle = t.store.scope(first);
    // StrictMode subscribes, releases, then subscribes again through the same handle.
    handle.subscribe(() => {})();
    const release = handle.subscribe(() => {});
    expect(t.store.scope(first)).toBe(handle);

    handle.setViewed("a.ts", true);
    expect(t.store.scope(first)).toBe(handle);
    expect(t.send).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(400);
    expect(t.send).toHaveBeenCalledTimes(1);
    release();
  });

  it("does not keep a handle no reader subscribed through", () => {
    using t = setup();
    const discarded = t.store.scope(first);
    const committed = t.store.scope(first);
    expect(committed).not.toBe(discarded);
    const release = committed.subscribe(() => {});
    expect(t.store.scope(first)).toBe(committed);
    release();
  });

  it("sends the last presses to the scope being left, and ignores their answer", async () => {
    using t = setup();
    const left = t.store.scope(first);
    const releaseLeft = left.subscribe(() => {});
    left.setViewed("a.ts", true);
    releaseLeft();
    const entered = t.store.scope(second);
    const releaseEntered = entered.subscribe(() => {});

    expect(t.send).toHaveBeenCalledTimes(1);
    expect(t.send.mock.calls[0]?.[0]).toEqual(first);
    expect(t.answers.has("1")).toBe(false);
    expect(left.getSnapshot().size).toBe(0);

    t.settles[0]?.(AsyncResult.failure(Cause.fail("nope")));
    await vi.advanceTimersByTimeAsync(400);
    expect(t.reportFailure).not.toHaveBeenCalled();
    expect(t.refresh).toHaveBeenCalledWith(first);
    expect(t.send).toHaveBeenCalledTimes(1);
    releaseEntered();
  });

  it("keeps the scope while another reader still holds it", async () => {
    using t = setup();
    const scope = t.store.scope(first);
    const releaseA = scope.subscribe(() => {});
    const releaseB = scope.subscribe(() => {});
    scope.setViewed("a.ts", true);
    releaseA();
    expect(t.send).not.toHaveBeenCalled();
    expect(scope.getSnapshot().get("a.ts")).toBe(true);
    await vi.advanceTimersByTimeAsync(400);
    expect(t.send).toHaveBeenCalledTimes(1);
    releaseB();
  });

  it("holds a queued press over an answer that cannot have seen it", async () => {
    using t = setup();
    const scope = t.store.scope(first);
    const release = scope.subscribe(() => {});
    scope.setViewed("a.ts", true);
    const agreeing = answer(true);
    t.answerFor(first, agreeing);
    expect(scope.getSnapshot().get("a.ts")).toBe(true);
    await vi.advanceTimersByTimeAsync(400);
    t.settles[0]?.(AsyncResult.success(undefined));
    await vi.advanceTimersByTimeAsync(0);
    // The same answer published again is not a new read.
    t.answerFor(first, agreeing);
    expect(scope.getSnapshot().get("a.ts")).toBe(true);
    t.answerFor(first, answer(false));
    expect(scope.getSnapshot().size).toBe(0);
    release();
  });
});

it("batches automatic marks separately and preserves a manual unmark after their failure", async () => {
  using t = setup({
    files: [
      { path: "generated.ts", state: "unviewed" },
      { path: "mine.ts", state: "viewed" },
    ],
    truncated: false,
  });
  const scope = t.store.scope(first);
  const release = scope.subscribe(() => {});
  scope.markViewed(["generated.ts", "mine.ts"]);
  scope.setViewed("mine.ts", false);
  await vi.advanceTimersByTimeAsync(400);
  expect(t.send.mock.calls.map((call) => call[1])).toEqual([
    [{ path: "mine.ts", viewed: false }],
    [{ path: "generated.ts", viewed: true }],
  ]);
  t.settles[0]?.(AsyncResult.success(undefined));
  t.settles[1]?.(AsyncResult.fail("automatic mark failed"));
  await vi.advanceTimersByTimeAsync(0);
  expect([...scope.getSnapshot()]).toEqual([["mine.ts", false]]);
  scope.markViewed(["generated.ts", "mine.ts"]);
  await vi.advanceTimersByTimeAsync(400);
  expect(t.send).toHaveBeenCalledTimes(2);
  release();
});

it("sends every automatic mark within the contract limit", async () => {
  const files = Array.from({ length: MAX_FILES_VIEWED_PRESSES + 1 }, (_, index) => ({
    path: `${index}.ts`,
    state: "unviewed" as const,
  }));
  using t = setup({ files, truncated: false });
  const scope = t.store.scope(first);
  const release = scope.subscribe(() => {});
  scope.markViewed(files.map((file) => file.path));
  await vi.advanceTimersByTimeAsync(400);
  expect(t.send.mock.calls.map((call) => call[1].length)).toEqual([MAX_FILES_VIEWED_PRESSES, 1]);
  for (const settle of t.settles) settle(AsyncResult.success(undefined));
  await vi.advanceTimersByTimeAsync(0);
  release();
});

it("keeps the original five-part auto-viewed memory key across routing options", () => {
  expect(autoViewedMemoryScopeKey(first)).toBe('["files-viewed","project",null,"t3/code",1]');
  const target = {
    ...first,
    reference: {
      ...first.reference,
      host: "github.example",
      allowStale: true,
      expectedAccountId: "account",
    },
  };
  expect(autoViewedMemoryScopeKey(target)).toBe(
    '["files-viewed","project","github.example","t3/code",1]',
  );
  expect(autoViewedMemoryScopeKey(target)).toBe(
    autoViewedMemoryScopeKey({
      ...target,
      reference: { ...target.reference, allowStale: false, expectedAccountId: "other" },
    }),
  );
});
