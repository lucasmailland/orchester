// Tiny trailing-edge debounce with a cancel handle. Pure, dependency-free.
export interface Debounced<A extends unknown[]> {
  (...args: A): void;
  cancel: () => void;
}

export function debounce<A extends unknown[]>(
  fn: (...args: A) => void,
  waitMs: number
): Debounced<A> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const wrapped = ((...args: A) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      fn(...args);
    }, waitMs);
  }) as Debounced<A>;
  wrapped.cancel = () => {
    if (timer) clearTimeout(timer);
    timer = null;
  };
  return wrapped;
}
