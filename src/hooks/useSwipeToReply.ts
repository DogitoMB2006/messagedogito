import { useCallback, useEffect, useRef } from 'react';

const MIN_DX = 52;
const MAX_ABS_DY = 46;
/** Visual cap (px) — rubber-band asymptote */
const MAX_SHIFT = 78;
const COMMIT_HINT_AT = 44;
const SPRING_BACK_MS = 400;
const CLEANUP_DELAY_MS = 480;

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
  nearCommit: boolean;
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

function applyShiftDOM(el: HTMLElement | null, offset: number, animate: boolean): void {
  if (!el) return;
  if (animate) {
    el.style.transition = `transform ${SPRING_BACK_MS}ms cubic-bezier(0.22, 1, 0.36, 1)`;
    el.style.willChange = '';
  } else {
    el.style.transition = 'none';
    el.style.willChange = 'transform';
  }
  el.style.transform = offset !== 0 ? `translate3d(${offset}px, 0, 0)` : '';
}

function applyTrackDOM(el: HTMLElement | null, offset: number, animate: boolean, nearCommit: boolean): void {
  if (!el) return;
  const p = Math.min(1, offset / 42);
  const eased = 1 - (1 - p) * (1 - p);
  const opacity = offset > 0 ? 0.12 + 0.88 * eased : 0;
  const scale = offset > 0 ? 0.68 + 0.32 * eased : 0.65;
  if (animate) {
    el.style.transition = `opacity ${SPRING_BACK_MS * 0.75}ms cubic-bezier(0.22, 1, 0.36, 1), transform ${SPRING_BACK_MS}ms cubic-bezier(0.22, 1, 0.36, 1)`;
  } else {
    el.style.transition = 'none';
  }
  el.style.opacity = String(opacity);
  el.style.transform = `scale(${scale})`;
  // data attribute drives CSS ring — zero React state
  el.dataset.swipeNear = nearCommit ? 'true' : 'false';
}

/**
 * Telegram/WhatsApp-style swipe/drag right.
 * Pure DOM manipulation — ZERO React state changes during any part of the gesture.
 * The commit-hint ring is driven by a data-swipe-near CSS attribute, not React state.
 */
export function useSwipeToReply({ enabled, onReply }: Options) {
  const optsRef = useRef<Options>({ enabled, onReply });
  optsRef.current = { enabled, onReply };

  const sessionRef = useRef<Session | null>(null);
  const rafRef = useRef<number | null>(null);
  const pendingOffsetRef = useRef(0);
  const settleTimerRef = useRef<number | null>(null);

  // DOM element registries keyed by msgId string
  const shiftElMap = useRef<Map<string, HTMLElement | null>>(new Map());
  const trackElMap = useRef<Map<string, HTMLElement | null>>(new Map());

  const registerShiftEl = useCallback((key: string, el: HTMLElement | null) => {
    if (key) shiftElMap.current.set(key, el ?? null);
  }, []);

  const registerTrackEl = useCallback((key: string, el: HTMLElement | null) => {
    if (key) trackElMap.current.set(key, el ?? null);
  }, []);

  const clearSettleTimer = useCallback(() => {
    if (settleTimerRef.current != null) {
      window.clearTimeout(settleTimerRef.current);
      settleTimerRef.current = null;
    }
  }, []);

  useEffect(() => () => clearSettleTimer(), [clearSettleTimer]);

  const flushRaf = useCallback(() => {
    rafRef.current = null;
    const s = sessionRef.current;
    if (!s) return;
    const offset = pendingOffsetRef.current;
    const nearCommit = offset >= COMMIT_HINT_AT;

    // Pure DOM — zero React re-renders, always
    applyShiftDOM(shiftElMap.current.get(s.msgKey) ?? null, offset, false);
    applyTrackDOM(trackElMap.current.get(s.msgKey) ?? null, offset, false, nearCommit);
    s.nearCommit = nearCommit;
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
        nearCommit: false,
      };
      pendingOffsetRef.current = 0;
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
      pendingOffsetRef.current = s.canceled ? 0 : rubberShift(dx);
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

      const dx = e.clientX - s.x;
      const dy = e.clientY - s.y;
      const success =
        optsRef.current.enabled && !s.canceled && dx >= MIN_DX && Math.abs(dy) <= MAX_ABS_DY;

      // Spring back via CSS transition — no React involvement
      const shiftEl = shiftElMap.current.get(s.msgKey) ?? null;
      const trackEl = trackElMap.current.get(s.msgKey) ?? null;
      applyShiftDOM(shiftEl, 0, true);
      applyTrackDOM(trackEl, 0, true, false);

      if (success) {
        optsRef.current.onReply(s.msg);
        if (e.type !== 'pointercancel') e.preventDefault();
      }

      // Freeze inline styles at resting state after spring-back
      clearSettleTimer();
      const capturedKey = s.msgKey;
      settleTimerRef.current = window.setTimeout(() => {
        settleTimerRef.current = null;
        const se = shiftElMap.current.get(capturedKey);
        const te = trackElMap.current.get(capturedKey);
        if (se) {
          se.style.transition = 'none';
          se.style.transform = '';
          se.style.willChange = '';
        }
        if (te) {
          te.style.transition = 'none';
          te.style.opacity = '0';
          te.style.transform = 'scale(0.65)';
          te.dataset.swipeNear = 'false';
        }
      }, CLEANUP_DELAY_MS);
    },
    [clearSettleTimer],
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

  return {
    getMessageSwipeHandlers,
    registerShiftEl,
    registerTrackEl,
    msgKeyOf,
  };
}
