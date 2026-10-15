import { describe, expect, it } from "vite-plus/test";

import { returnFocusFromHiddenWebview } from "./webviewFocus";

const mount = <Tag extends keyof HTMLElementTagNameMap>(tagName: Tag) => {
  const element = document.createElement(tagName);
  element.tabIndex = -1;
  document.body.append(element);
  return Object.assign(element, {
    [Symbol.dispose]: () => element.remove(),
  });
};

const hiddenWebview = () => {
  const webview = mount("webview");
  webview.addEventListener("focus", returnFocusFromHiddenWebview);
  return webview;
};

describe("returnFocusFromHiddenWebview", () => {
  it("gives focus back to the composer the page took it from", () => {
    using composer = mount("textarea");
    using webview = hiddenWebview();
    composer.focus();

    webview.focus();

    expect(document.activeElement).toBe(composer);
  });

  it("leaves no focus in the page when nothing had it before", () => {
    using webview = hiddenWebview();

    webview.focus();

    expect(document.activeElement).not.toBe(webview);
  });

  it("leaves no focus in the page when the previous element no longer takes it", () => {
    using composer = mount("textarea");
    using webview = hiddenWebview();
    composer.focus();
    composer.disabled = true;

    webview.focus();

    expect(document.activeElement).not.toBe(webview);
  });
});
