import { useEffect, useState } from 'react';

/** `null` before mount / in non-browser environments */
export function useViewportInnerWidth(): number | null {
  const [w, setW] = useState<number | null>(null);

  useEffect(() => {
    const ro = new ResizeObserver(() => {
      setW(window.innerWidth);
    });
    setW(window.innerWidth);
    ro.observe(document.documentElement);
    return () => ro.disconnect();
  }, []);

  return w;
}
