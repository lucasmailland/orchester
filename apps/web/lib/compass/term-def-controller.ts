/**
 * TermDef singleton controller.
 *
 * Why this exists
 * ---------------
 * Each TermDef previously toggled its own local state on raw mouse events with
 * zero delay. Sweeping across "Mnemosyne, brain, fact" in one paragraph flashed
 * three popovers in sequence — visual storm, useless to read, and an a11y
 * nightmare. This module centralises open/close intent across every TermDef on
 * the page so that:
 *
 *   1. At most one popover is open at a time.
 *   2. Hover-in waits ~120ms (intent debounce) before opening — flicking past a
 *      term does nothing.
 *   3. Hover-out waits ~100ms — slipping into the popover doesn't close it, and
 *      moving from one TermDef to the next swaps instantly instead of
 *      close→delay→open.
 *   4. Keyboard / click "lock open" intent overrides hover scheduling until the
 *      user explicitly dismisses (Esc, outside click, blur).
 *
 * SSR safety
 * ----------
 * No `window` / `document` access in module scope. State is plain module-level;
 * timers are created lazily inside the request* functions.
 */

type Listener = (active: boolean) => void;

interface ControllerState {
  activeId: string | null;
  scheduledOpenId: string | null;
  openTimer: ReturnType<typeof setTimeout> | null;
  closeTimer: ReturnType<typeof setTimeout> | null;
  // Pending callbacks paired with the live timer, so we can fire them on flush.
  pendingOpen: { id: string; cb: () => void } | null;
  pendingClose: { id: string; cb: () => void } | null;
  listeners: Map<string, Set<Listener>>;
  lockedIds: Set<string>;
}

const state: ControllerState = {
  activeId: null,
  scheduledOpenId: null,
  openTimer: null,
  closeTimer: null,
  pendingOpen: null,
  pendingClose: null,
  listeners: new Map(),
  lockedIds: new Set(),
};

function notify(id: string, active: boolean): void {
  const set = state.listeners.get(id);
  if (!set) return;
  for (const listener of set) listener(active);
}

function clearOpenTimer(): void {
  if (state.openTimer !== null) {
    clearTimeout(state.openTimer);
    state.openTimer = null;
  }
  state.pendingOpen = null;
  state.scheduledOpenId = null;
}

function clearCloseTimer(): void {
  if (state.closeTimer !== null) {
    clearTimeout(state.closeTimer);
    state.closeTimer = null;
  }
  state.pendingClose = null;
}

function activate(id: string, openCallback: () => void): void {
  // If something else was active, close it synchronously (instant swap).
  if (state.activeId !== null && state.activeId !== id) {
    const prev = state.activeId;
    state.activeId = null;
    state.lockedIds.delete(prev);
    notify(prev, false);
  }
  state.activeId = id;
  openCallback();
  notify(id, true);
}

function deactivate(id: string, closeCallback: () => void): void {
  if (state.activeId !== id) return;
  state.activeId = null;
  state.lockedIds.delete(id);
  closeCallback();
  notify(id, false);
}

/**
 * Schedule an open. If the same id is already active, no-op. If a different id
 * is active, this cancels its pending close and swaps activation immediately
 * (no gap between the two popovers).
 */
export function requestOpen(id: string, openCallback: () => void, delayMs = 120): void {
  // Already active — nothing to do, just cancel any pending close on it.
  if (state.activeId === id) {
    if (state.pendingClose && state.pendingClose.id === id) {
      clearCloseTimer();
    }
    return;
  }

  // Cancel any other scheduled open (intent moved to a new term).
  if (state.scheduledOpenId !== null && state.scheduledOpenId !== id) {
    clearOpenTimer();
  }

  // If another term is currently active, cancel its pending close and swap
  // instantly — this is the "moving sideways" path.
  if (state.activeId !== null && state.activeId !== id) {
    clearCloseTimer();
    clearOpenTimer();
    activate(id, openCallback);
    return;
  }

  // Nothing active yet — schedule the open after the intent debounce.
  if (state.scheduledOpenId === id && state.openTimer !== null) return;

  state.scheduledOpenId = id;
  state.pendingOpen = { id, cb: openCallback };
  state.openTimer = setTimeout(() => {
    state.openTimer = null;
    state.scheduledOpenId = null;
    const pending = state.pendingOpen;
    state.pendingOpen = null;
    if (pending) activate(pending.id, pending.cb);
  }, delayMs);
}

/**
 * Schedule a close. If the term gets re-hovered (or another opens) before the
 * timer fires, it's cancelled.
 */
export function requestClose(id: string, closeCallback: () => void, delayMs = 100): void {
  // If this id had a pending open, cancel it — user left before it opened.
  if (state.scheduledOpenId === id) {
    clearOpenTimer();
    return;
  }
  // Locked open (keyboard / click) — only explicit close clears it.
  if (state.lockedIds.has(id)) return;
  if (state.activeId !== id) return;

  // Replace any existing close timer.
  clearCloseTimer();
  state.pendingClose = { id, cb: closeCallback };
  state.closeTimer = setTimeout(() => {
    state.closeTimer = null;
    const pending = state.pendingClose;
    state.pendingClose = null;
    if (pending) deactivate(pending.id, pending.cb);
  }, delayMs);
}

/**
 * Cancel any pending timer (open or close) for this id. Called when a contrary
 * event fires within the debounce window.
 */
export function cancelPending(id: string): void {
  if (state.scheduledOpenId === id) clearOpenTimer();
  if (state.pendingClose && state.pendingClose.id === id) clearCloseTimer();
}

/**
 * Force-open immediately, bypassing the debounce. Used for keyboard activation
 * (Enter / Space) and tap on touch devices. Optionally locks the popover so
 * hover-out won't close it.
 */
export function forceOpen(
  id: string,
  openCallback: () => void,
  options: { lock?: boolean } = {}
): void {
  clearOpenTimer();
  clearCloseTimer();
  if (state.activeId !== id) activate(id, openCallback);
  if (options.lock) state.lockedIds.add(id);
}

/**
 * Force-close immediately, bypassing the debounce. Used for Esc, outside click,
 * and explicit dismiss. Clears the lock if any.
 */
export function forceClose(id: string, closeCallback: () => void): void {
  clearOpenTimer();
  clearCloseTimer();
  state.lockedIds.delete(id);
  if (state.activeId === id) deactivate(id, closeCallback);
}

/** Currently active id, for read-only consumers (tests, devtools). */
export function getActiveId(): string | null {
  return state.activeId;
}

/** Whether a given id is locked open (keyboard / tap). */
export function isLocked(id: string): boolean {
  return state.lockedIds.has(id);
}

/**
 * Subscribe to active/inactive notifications for `id`. Returns an unsubscribe
 * function. The listener receives `true` when the controller activates the id
 * and `false` when it deactivates it.
 */
export function subscribe(id: string, listener: Listener): () => void {
  let set = state.listeners.get(id);
  if (!set) {
    set = new Set();
    state.listeners.set(id, set);
  }
  set.add(listener);
  return () => {
    const current = state.listeners.get(id);
    if (!current) return;
    current.delete(listener);
    if (current.size === 0) state.listeners.delete(id);
  };
}

/**
 * Test-only reset. Clears every timer, listener, and active id so each test
 * starts from a known clean slate.
 */
export function _resetControllerForTests(): void {
  if (state.openTimer !== null) clearTimeout(state.openTimer);
  if (state.closeTimer !== null) clearTimeout(state.closeTimer);
  state.activeId = null;
  state.scheduledOpenId = null;
  state.openTimer = null;
  state.closeTimer = null;
  state.pendingOpen = null;
  state.pendingClose = null;
  state.listeners.clear();
  state.lockedIds.clear();
}
