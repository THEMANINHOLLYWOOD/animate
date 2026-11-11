// Space plays and pauses a film, as in any video editor. A button reached with the keyboard keeps
// the key, though (Space presses it): only a button that was clicked with the mouse, which holds
// focus without showing it, lets Space through to the player.
export function spacePresses(el: Element | null | undefined): boolean {
  const b = el?.closest?.("button, a[href], summary, [role='button']");
  if (!b) return false;
  try {
    return b.matches(":focus-visible");
  } catch {
    return false;
  }
}
