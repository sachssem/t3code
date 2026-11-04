import { expect, it, vi } from "vite-plus/test";
import {
  compileResolvedKeybindingsConfig,
  DEFAULT_RESOLVED_KEYBINDINGS,
} from "@t3tools/shared/keybindings";

import { shouldTypeToFocusComposer } from "./composerFocusRedirect";

function setup() {
  const hoveredFile = {};
  const querySelector = vi.fn((selector: string) =>
    selector === "[data-pull-request-viewed-shortcut] diffs-container:hover" ? hoveredFile : null,
  );
  vi.stubGlobal("document", { querySelector });
  vi.stubGlobal("Element", class Element extends EventTarget {});
  return {
    querySelector,
    [Symbol.dispose]: () => vi.unstubAllGlobals(),
  };
}

function keydown(key: string, overrides: Partial<KeyboardEvent> = {}) {
  return {
    key,
    code: `Key${key.toUpperCase()}`,
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    target: null,
    composedPath: () => [],
    ...overrides,
  } as KeyboardEvent;
}

it("reserves v for a hovered PR file and releases it when no file is hovered", () => {
  using fixture = setup();
  expect(shouldTypeToFocusComposer(keydown("v"), DEFAULT_RESOLVED_KEYBINDINGS)).toBe(false);
  expect(shouldTypeToFocusComposer(keydown("x"), DEFAULT_RESOLVED_KEYBINDINGS)).toBe(true);
  expect(
    shouldTypeToFocusComposer(keydown("V", { shiftKey: true }), DEFAULT_RESOLVED_KEYBINDINGS),
  ).toBe(true);
  fixture.querySelector.mockReturnValue(null);
  expect(shouldTypeToFocusComposer(keydown("v"), DEFAULT_RESOLVED_KEYBINDINGS)).toBe(true);
});

it("reserves the configured shortcut instead of the default letter", () => {
  using _fixture = setup();
  const keybindings = compileResolvedKeybindingsConfig([
    { command: "pullRequest.toggleViewed", key: "x", when: "!editableFocus && !terminalFocus" },
  ]);
  expect(shouldTypeToFocusComposer(keydown("v"), keybindings)).toBe(true);
  expect(shouldTypeToFocusComposer(keydown("x"), keybindings)).toBe(false);
  expect(shouldTypeToFocusComposer(keydown("x"), [])).toBe(true);
});
