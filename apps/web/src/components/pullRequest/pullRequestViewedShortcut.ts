// Query at keydown so scrolling or folding beneath a stationary pointer picks the current file.
export function getHoveredPullRequestDiff(): Element | null {
  return document.querySelector("[data-pull-request-viewed-shortcut] diffs-container:hover");
}
