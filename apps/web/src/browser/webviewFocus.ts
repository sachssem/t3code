// Hidden tabs can receive focus through CDP or page autofocus; restore the host focus.
export function returnFocusFromHiddenWebview(event: FocusEvent): void {
  const webview = event.currentTarget;
  if (!(webview instanceof HTMLElement)) return;
  const previous = event.relatedTarget;
  if (previous instanceof HTMLElement && previous.isConnected && previous !== document.body) {
    previous.focus({ preventScroll: true });
  }
  // The previous element may no longer take focus. Never leave focus in the page.
  if (document.activeElement === webview) webview.blur();
}
