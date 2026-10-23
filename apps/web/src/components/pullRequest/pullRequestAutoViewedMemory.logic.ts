import type { AutoCollapsedFilesViewedMemory } from "./pullRequestFilesViewed.logic";

type StoredMemory = ReadonlyArray<{
  readonly scope: string;
  readonly touched: ReadonlyArray<string>;
  readonly remarked: ReadonlyArray<string>;
}>;

export function createAutoViewedMemoryStore(
  read: () => StoredMemory,
  write: (entries: StoredMemory) => void,
) {
  let memories: Map<string, AutoCollapsedFilesViewedMemory> | undefined;
  return (scope: string, update: (memory: AutoCollapsedFilesViewedMemory) => void) => {
    memories ??= new Map(
      read()
        .slice(-200)
        .map((entry) => [
          entry.scope,
          {
            touched: new Set(entry.touched),
            remarked: new Set(entry.remarked),
          },
        ]),
    );
    const memory = memories.get(scope) ?? {
      touched: new Set<string>(),
      remarked: new Set<string>(),
    };
    const before = JSON.stringify([[...memory.touched], [...memory.remarked]]);
    update(memory);
    if (before === JSON.stringify([[...memory.touched], [...memory.remarked]])) return;
    memories.delete(scope);
    memories.set(scope, memory);
    while (memories.size > 200) memories.delete(memories.keys().next().value!);
    write(
      [...memories].map(([scope, memory]) => ({
        scope,
        touched: [...memory.touched],
        remarked: [...memory.remarked],
      })),
    );
  };
}
