import type { RealtimeChannel } from '@supabase/supabase-js';
import { REALTIME_SUBSCRIBE_STATES } from '@supabase/realtime-js';

/**
 * Resolves when the channel has joined; avoids `send()` falling back to REST before the socket can push.
 * @param joinTimeoutMs Passed to Realtime `subscribe(_, joinTimeoutMs)` — default SDK join timeout (~10s) is too low for channels with many postgres bindings.
 * @param isCancelled When true, terminal states (e.g. CLOSED from `removeChannel` during Strict Mode or chat switch) resolve quietly instead of rejecting.
 */
export function whenRealtimeSubscribed(
  channel: RealtimeChannel,
  joinTimeoutMs = 30_000,
  isCancelled?: () => boolean,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const outerMs = joinTimeoutMs + 10_000;
    const timer = window.setTimeout(() => {
      if (isCancelled?.()) {
        resolve();
        return;
      }
      reject(new Error('Realtime subscribe timed out'));
    }, outerMs);
    channel.subscribe(
      (status) => {
        if (status === REALTIME_SUBSCRIBE_STATES.SUBSCRIBED) {
          window.clearTimeout(timer);
          resolve();
        } else if (
          status === REALTIME_SUBSCRIBE_STATES.CHANNEL_ERROR ||
          status === REALTIME_SUBSCRIBE_STATES.TIMED_OUT ||
          status === REALTIME_SUBSCRIBE_STATES.CLOSED
        ) {
          window.clearTimeout(timer);
          if (isCancelled?.()) {
            resolve();
            return;
          }
          reject(new Error(`Realtime subscribe failed: ${status}`));
        }
      },
      joinTimeoutMs,
    );
  });
}
