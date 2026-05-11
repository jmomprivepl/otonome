import { useEffect, useRef, type RefObject } from 'react';
import { isTauriRuntime } from '@/config/nativeLlm';
import { webviewDebugLog } from '@/lib/webviewDebugLog';

type Options = {
  label: string;
  flowRenderReady: boolean;
  hostRef: RefObject<HTMLElement | null>;
  reactNodeCount: number;
  recoveryNonce: number;
  onRemount: () => void;
  /** e.g. bump fitView trigger after React Flow remounts */
  onAfterRemount?: () => void;
};

/**
 * WebView2 can blank the transformed React Flow layer while the DOM still looks healthy.
 * Polls the host while the graph should be visible; remounts React Flow if blank signals persist.
 */
export function useTauriReactFlowBlankWatchdog({
  label,
  flowRenderReady,
  hostRef,
  reactNodeCount,
  recoveryNonce,
  onRemount,
  onAfterRemount,
}: Options): void {
  const strikeRef = useRef(0);
  const repaintThrottleRef = useRef(0);
  const onRemountRef = useRef(onRemount);
  const onAfterRemountRef = useRef(onAfterRemount);
  onRemountRef.current = onRemount;
  onAfterRemountRef.current = onAfterRemount;

  useEffect(() => {
    if (!isTauriRuntime()) return;
    if (!flowRenderReady) return;
    if (reactNodeCount === 0) return;

    const host = hostRef.current;
    if (!host) return;

    const id = window.setInterval(() => {
      try {
        const hostRect = host.getBoundingClientRect();
        if (hostRect.width < 24 || hostRect.height < 24) return;

        const viewport = host.querySelector<HTMLElement>('.react-flow__viewport');
        if (!viewport) return;

        const domCount = host.querySelectorAll('.react-flow__node').length;
        const first = host.querySelector<HTMLElement>('.react-flow__node');
        const tinyNode =
          first != null &&
          (() => {
            const r = first.getBoundingClientRect();
            return r.width <= 2 || r.height <= 2;
          })();

        const domMismatch = reactNodeCount > 0 && domCount === 0;
        const vcs = window.getComputedStyle(viewport);
        const opacityBad =
          typeof vcs.opacity === 'string' &&
          Number.isFinite(Number.parseFloat(vcs.opacity)) &&
          Number.parseFloat(vcs.opacity) < 0.02;

        const blankLikely =
          domMismatch || tinyNode || opacityBad || vcs.visibility === 'hidden';
        if (!blankLikely) {
          strikeRef.current = 0;
          return;
        }

        strikeRef.current += 1;
        if (strikeRef.current < 3) return;

        const vpRect = viewport.getBoundingClientRect();
        void webviewDebugLog(`${label}_BLANK_DETECTED`, {
          strike: strikeRef.current,
          reactNodes: reactNodeCount,
          domNodes: domCount,
          tinyNode,
          domMismatch,
          opacityBad,
          visibility: vcs.visibility,
          opacity: vcs.opacity,
          hostW: hostRect.width,
          hostH: hostRect.height,
          vpW: vpRect.width,
          vpH: vpRect.height,
        });

        const now = Date.now();
        if (strikeRef.current <= 10 && now - repaintThrottleRef.current > 450) {
          repaintThrottleRef.current = now;
          try {
            const prevVis = viewport.style.visibility;
            viewport.style.visibility = 'hidden';
            void viewport.offsetHeight;
            viewport.style.visibility = prevVis;
          } catch {
            /* ignore */
          }
          return;
        }

        if (strikeRef.current >= 11) {
          void webviewDebugLog(`${label}_RECOVER_REMOUNT`, { recoveryNonceBefore: recoveryNonce });
          onRemountRef.current();
          onAfterRemountRef.current?.();
          strikeRef.current = 0;
        }
      } catch {
        /* ignore */
      }
    }, 260);

    return () => window.clearInterval(id);
  }, [label, flowRenderReady, reactNodeCount, recoveryNonce, hostRef]);
}
