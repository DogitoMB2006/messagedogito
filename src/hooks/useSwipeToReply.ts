import type { CSSProperties } from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';

const MIN_DX = 52;
const MAX_ABS_DY = 46;
/** Visual cap (px) — rubber-band asymptote */
const MAX_SHIFT = 78;
const COMMIT_HINT_AT = 44;

type Options = {
  enabled: boolean;
  onReply: (msg: unknown) => void;
};

type Session = {
  pointerId: number;
  x: number;
  y: number;
  canceled: boolean;
  msg: unknown;
  msgKey: string;
};

type VisualState = {
  key: string | null;
  offset: number;
  dragging: boolean;
};

function isInteractiveTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el?.closest) return false;
  return Boolean(el.closest('a, button, input, textarea, select, [role="button"]'));
}

/** Smooth rubber-band: approaches MAX_SHIFT without hard clamp jank */
function rubberShift(rawDx: number): number {
  if (rawDx <= 0) return 0;
  const t = Math.tanh((rawDx * 0.62) / MAX_SHIFT);
  return MAX_SHIFT * t;
}

/**
 * Telegram/WhatsApp-style swipe/drag right with motion + reply affordance.
 * Pointer events: mouse, touch, pen. Spring-back uses CSS transition.
 */
export function useSwipeToReply({ enabled, onReply }: Options) {
  const optsRef = useRef<Options>({ enabled, onReply });
  optsRef.current = { enabled, onReply };

  const sessionRef = useRef<Session | null>(null);
  const [visual, setVisual] = useState<VisualState>({ key: null, offset: 0, dragging: false });
  const rafRef = useRef<number | null>(null);
  const pendingOffsetRef = useRef(0);
  const pendingKeyRef = useRef<string | null>(null);
  const settleTimerRef = useRef<number | null>(null);

  const clearSettleTimer = useCallback(() => {
    if (settleTimerRef.current != null) {
      window.clearTimeout(settleTimerRef.current);
      settleTimerRef.current = null;
    }
  }, []);

  const scheduleVisualReset = useCallback(() => {
    clearSettleTimer();
    settleTimerRef.current = window.setTimeout(() => {
      settleTimerRef.current = null;
      setVisual({ key: null, offset: 0, dragging: false });
    }, 460);
  }, [clearSettleTimer]);

  useEffect(() => () => clearSettleTimer(), [clearSettleTimer]);

  const flushRaf = useCallback(() => {
    rafRef.current = null;
    const key = pendingKeyRef.current;
    const off = pendingOffsetRef.current;
    if (key == null) return;
    setVisual({ key, offset: off, dragging: true });
  }, []);

  const onPointerDown = useCallback(
    (msg: unknown) => (e: React.PointerEvent) => {
      if (!optsRef.current.enabled) return;
      const m = msg as { id?: unknown } | null;
      if (m == null || m.id == null) return;
      if (sessionRef.current) return;
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      if (isInteractiveTarget(e.target)) return;

      clearSettleTimer();
      const msgKey = String(m.id);
      sessionRef.current = {
        pointerId: e.pointerId,
        x: e.clientX,
        y: e.clientY,
        canceled: false,
        msg,
        msgKey,
      };
      pendingKeyRef.current = msgKey;
      pendingOffsetRef.current = 0;
      setVisual({ key: msgKey, offset: 0, dragging: true });
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    },
    [clearSettleTimer],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      const s = sessionRef.current;
      if (!s || e.pointerId !== s.pointerId) return;
      const dx = e.clientX - s.x;
      const dy = e.clientY - s.y;
      if (Math.abs(dy) > 18 && Math.abs(dy) > Math.abs(dx) * 1.12) {
        s.canceled = true;
      }
      const shift = s.canceled ? 0 : rubberShift(dx);
      pendingKeyRef.current = s.msgKey;
      pendingOffsetRef.current = shift;
      if (rafRef.current == null) {
        rafRef.current = requestAnimationFrame(flushRaf);
      }
    },
    [flushRaf],
  );

  const finishPointer = useCallback(
    (e: React.PointerEvent) => {
      const s = sessionRef.current;
      if (!s || e.pointerId !== s.pointerId) return;

      const el = e.currentTarget as HTMLElement;
      try {
        el.releasePointerCapture(e.pointerId);
      } catch {
        /* already released */
      }
      sessionRef.current = null;
      if (rafRef.current != null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      pendingKeyRef.current = null;

      if (e.type === 'pointercancel') {
        setVisual({ key: s.msgKey, offset: 0, dragging: false });
        scheduleVisualReset();
        return;
      }

      const dx = e.clientX - s.x;
      const dy = e.clientY - s.y;
      const success =
        optsRef.current.enabled && !s.canceled && dx >= MIN_DX && Math.abs(dy) <= MAX_ABS_DY;

      setVisual({ key: s.msgKey, offset: 0, dragging: false });
      if (success) {
        optsRef.current.onReply(s.msg);
        e.preventDefault();
      }
      scheduleVisualReset();
    },
    [scheduleVisualReset],
  );

  const getMessageSwipeHandlers = useCallback(
    (msg: unknown) => ({
      onPointerDown: onPointerDown(msg),
      onPointerMove,
      onPointerUp: finishPointer,
      onPointerCancel: finishPointer,
    }),
    [onPointerDown, onPointerMove, finishPointer],
  );

  const msgKeyOf = useCallback((msg: unknown) => {
    const m = msg as { id?: unknown } | null;
    return m?.id != null ? String(m.id) : '';
  }, []);

  const getSwipeShiftStyle = useCallback(
    (msg: unknown): CSSProperties => {
      const key = msgKeyOf(msg);
      if (!key || visual.key !== key) return {};
      return {
        transform: `translate3d(${visual.offset}px, 0, 0)`,
        transition: visual.dragging ? 'none' : 'transform 0.44s cubic-bezier(0.22, 1, 0.36, 1)',
        willChange: visual.dragging ? 'transform' : undefined,
      };
    },
    [msgKeyOf, visual.dragging, visual.key, visual.offset],
  );

  const getSwipeTrackStyle = useCallback(
    (msg: unknown): CSSProperties => {
      const key = msgKeyOf(msg);
      const active = Boolean(key && visual.key === key);
      if (!active) {
        return {
          opacity: 0,
          transform: 'scale(0.65)',
          transition: 'opacity 0.28s ease, transform 0.36s cubic-bezier(0.22, 1, 0.36, 1)',
        };
      }
      const p = Math.min(1, visual.offset / 42);
      const eased = 1 - (1 - p) * (1 - p);
      return {
        opacity: 0.12 + 0.88 * eased,
        transform: `scale(${0.68 + 0.32 * eased})`,
        transition: visual.dragging
          ? 'none'
          : 'opacity 0.36s cubic-bezier(0.22, 1, 0.36, 1), transform 0.4s cubic-bezier(0.22, 1, 0.36, 1)',
      };
    },
    [msgKeyOf, visual.dragging, visual.key, visual.offset],
  );

  const isSwipeNearCommit = useCallback(
    (msg: unknown) => {
      const key = msgKeyOf(msg);
      return Boolean(key && visual.key === key && visual.dragging && visual.offset >= COMMIT_HINT_AT);
    },
    [msgKeyOf, visual.dragging, visual.key, visual.offset],
  );

  return { getMessageSwipeHandlers, getSwipeShiftStyle, getSwipeTrackStyle, isSwipeNearCommit };
}
