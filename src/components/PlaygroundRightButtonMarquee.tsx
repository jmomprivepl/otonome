import { useEffect, useRef, useState } from 'react';
import { useReactFlow } from 'reactflow';

const MIN_DRAG_PX = 6;

function shouldIgnoreMarqueeTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  return !!target.closest(
    'input, textarea, select, button, a, [contenteditable="true"], .nodrag, .nopan, .react-flow__handle',
  );
}

type ClientRect = { x1: number; y1: number; x2: number; y2: number };

/**
 * Right mouse button drag on the pane draws a marquee and selects intersecting nodes.
 * React Flow's built-in selection rectangle only uses the left button; this complements it.
 */
export function PlaygroundRightButtonMarquee({
  rootId,
  onCommit,
  disabled,
}: {
  rootId: string;
  onCommit: (nodeIds: string[], event: MouseEvent) => void;
  disabled?: boolean;
}) {
  const { screenToFlowPosition, getIntersectingNodes } = useReactFlow();
  const [marquee, setMarquee] = useState<ClientRect | null>(null);
  const activeRef = useRef(false);
  const rectRef = useRef<ClientRect | null>(null);

  useEffect(() => {
    if (disabled) return;

    let cancelled = false;
    let detach: (() => void) | undefined;

    const attach = (pane: HTMLElement) => {
      const onMove = (e: MouseEvent) => {
        if (!activeRef.current || !rectRef.current) return;
        rectRef.current = {
          ...rectRef.current,
          x2: e.clientX,
          y2: e.clientY,
        };
        setMarquee({ ...rectRef.current });
      };

    const finish = (e: MouseEvent) => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', finish, true);
      if (!activeRef.current || !rectRef.current) {
        activeRef.current = false;
        rectRef.current = null;
        setMarquee(null);
        return;
      }
      if (e.button !== 2) {
        activeRef.current = false;
        rectRef.current = null;
        setMarquee(null);
        return;
      }
      activeRef.current = false;
      const { x1, y1, x2, y2 } = rectRef.current;
      rectRef.current = null;
      setMarquee(null);

      const w = Math.abs(x2 - x1);
      const h = Math.abs(y2 - y1);
      if (w < MIN_DRAG_PX && h < MIN_DRAG_PX) {
        return;
      }

      const minX = Math.min(x1, x2);
      const minY = Math.min(y1, y2);
      const maxX = Math.max(x1, x2);
      const maxY = Math.max(y1, y2);

      const c1 = screenToFlowPosition({ x: minX, y: minY });
      const c2 = screenToFlowPosition({ x: maxX, y: maxY });
      const rect = {
        x: c1.x,
        y: c1.y,
        width: Math.max(c2.x - c1.x, 1),
        height: Math.max(c2.y - c1.y, 1),
      };

      const hit = getIntersectingNodes(rect, true);
      onCommit(
        hit.map((n) => n.id),
        e,
      );
    };

    const onDown = (e: MouseEvent) => {
      if (e.button !== 2) return;
      if (shouldIgnoreMarqueeTarget(e.target)) return;
      e.preventDefault();
      e.stopPropagation();
      activeRef.current = true;
      rectRef.current = { x1: e.clientX, y1: e.clientY, x2: e.clientX, y2: e.clientY };
      setMarquee({ ...rectRef.current });
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', finish, true);
    };

      pane.addEventListener('mousedown', onDown, true);
      detach = () => {
        pane.removeEventListener('mousedown', onDown, true);
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', finish, true);
      };
    };

    let attempts = 0;
    const tryAttach = () => {
      if (cancelled) return;
      attempts += 1;
      if (attempts > 180) return;
      const root = document.getElementById(rootId);
      const pane = root?.querySelector('.react-flow__pane') as HTMLElement | null;
      if (!pane) {
        requestAnimationFrame(tryAttach);
        return;
      }
      attach(pane);
    };

    requestAnimationFrame(tryAttach);

    return () => {
      cancelled = true;
      detach?.();
    };
  }, [rootId, disabled, screenToFlowPosition, getIntersectingNodes, onCommit]);

  if (!marquee) return null;

  const left = Math.min(marquee.x1, marquee.x2);
  const top = Math.min(marquee.y1, marquee.y2);
  const width = Math.abs(marquee.x2 - marquee.x1);
  const height = Math.abs(marquee.y2 - marquee.y1);

  return (
    <div
      className="pointer-events-none fixed z-[70] border-2 border-violet-500/90 bg-violet-500/15 dark:border-violet-400/90 dark:bg-violet-400/10"
      style={{ left, top, width, height }}
      aria-hidden
    />
  );
}
