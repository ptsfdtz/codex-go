import { useEffect, useRef, useState } from 'react';

export function usePreference<T extends string | boolean>(
  key: string,
  fallback: T,
  valid: (value: unknown) => value is T,
) {
  const read = () => {
    try {
      const value = JSON.parse(localStorage.getItem(key) || 'null');
      return valid(value) ? value : fallback;
    } catch {
      return fallback;
    }
  };
  const [value, setValue] = useState<T>(read);
  const readRef = useRef(read);
  readRef.current = read;
  useEffect(() => {
    const changed = (event: StorageEvent) => {
      if (event.key === key || event.key === null) setValue(readRef.current());
    };
    window.addEventListener('storage', changed);
    return () => window.removeEventListener('storage', changed);
  }, [key]);
  const save = (next: T) => {
    setValue(next);
    try {
      localStorage.setItem(key, JSON.stringify(next));
    } catch {
      /* Keep the in-page preference when storage is unavailable. */
    }
  };
  return [value, save] as const;
}
