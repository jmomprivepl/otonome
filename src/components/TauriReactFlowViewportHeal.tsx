import { useEffect } from 'react';
import { useReactFlow } from 'reactflow';

/**
 * WebView2 can drop the painted layer for transformed subtrees while layout/DOM stay valid.
 * Nudging the React Flow viewport (then restoring) forces a compositor repaint without moving the graph visibly.
 */
export function TauriReactFlowViewportHeal({ nonce }: { nonce: number }) {
  const { getViewport, setViewport } = useReactFlow();

  useEffect(() => {
    if (nonce === 0) return;
    const v = getViewport();
    if (
      typeof v.x !== 'number' ||
      typeof v.y !== 'number' ||
      typeof v.zoom !== 'number' ||
      !Number.isFinite(v.x) ||
      !Number.isFinite(v.y) ||
      !Number.isFinite(v.zoom) ||
      v.zoom <= 0
    ) {
      return;
    }

    const nudged = { x: v.x, y: v.y, zoom: v.zoom * 1.00005 };
    setViewport(nudged, { duration: 0 });
    const id = requestAnimationFrame(() => {
      setViewport(v, { duration: 0 });
    });
    return () => cancelAnimationFrame(id);
  }, [nonce, getViewport, setViewport]);

  return null;
}
