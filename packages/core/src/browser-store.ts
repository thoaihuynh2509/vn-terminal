"use client";

import { useSyncExternalStore } from "react";

/**
 * localStorage is an external store, so it is read through useSyncExternalStore
 * rather than copied into state inside an effect. That keeps the first render
 * consistent with what is actually stored and avoids the cascading re-render
 * that `setState` in an effect body causes.
 *
 * Every access is guarded: private mode and "block site data" make even reading
 * localStorage throw, and a market page must still render in that case.
 */
function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function writeStored(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    /* storage unavailable — the change simply does not persist */
  }
  window.dispatchEvent(new CustomEvent(`store:${key}`));
}

const subscribers = new Map<string, (onChange: () => void) => () => void>();

/**
 * One subscribe function per key, for good.
 *
 * `useSyncExternalStore` resubscribes whenever it is handed a different
 * function, and a fresh one per call made every render of every reader drop
 * and re-add its window listeners.
 */
export function storeSubscriber(key: string): (onChange: () => void) => () => void {
  let subscribe = subscribers.get(key);
  if (!subscribe) {
    subscribe = (onChange) => {
      const handler = () => onChange();
      // Same-tab writes fire the custom event; other tabs fire `storage`.
      window.addEventListener(`store:${key}`, handler);
      window.addEventListener("storage", handler);
      return () => {
        window.removeEventListener(`store:${key}`, handler);
        window.removeEventListener("storage", handler);
      };
    };
    subscribers.set(key, subscribe);
  }
  return subscribe;
}

/** Raw string snapshot — stable identity, so React can compare it cheaply. */
export function useStored(key: string): string | null {
  return useSyncExternalStore(
    storeSubscriber(key),
    () => read(key),
    () => null, // server render: nothing is stored yet
  );
}
