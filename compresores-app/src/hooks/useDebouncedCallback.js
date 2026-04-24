import { useRef, useCallback } from "react";

/**
 * Returns a debounced version of `fn` that delays invocation by `delay` ms.
 * On each call within the delay window the timer resets.
 *
 * Different from useDebounce (which debounces a value); this one debounces
 * a callback — useful for search handlers where you want to fire an async
 * function at most once every `delay` ms.
 */
export function useDebouncedCallback(fn, delay = 300) {
  const timer = useRef(null);
  return useCallback(
    (...args) => {
      clearTimeout(timer.current);
      timer.current = setTimeout(() => fn(...args), delay);
    },
    [fn, delay],
  );
}
