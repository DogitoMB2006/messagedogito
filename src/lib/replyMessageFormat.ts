import { isGroupLeaveMessage } from './groupMessageMarkers';

/** Prefix on stored message `content` when an uploaded image should show blurred until revealed. */
export const SPOILER_MEDIA_PREFIX = 'SPOILER|';

function isRawChatMediaUrl(v: string): boolean {
  const t = v.trim();
  if (!t) return false;
  try {
    const u = new URL(t);
    const path = u.pathname.toLowerCase();
    return /\.(gif|png|jpe?g|webp|svg|bmp|ico)$/.test(path);
  } catch {
    return /\.(gif|png|jpe?g|webp|svg|bmp|ico)(\?.*)?$/i.test(t);
  }
}

/** Build stored message content for an uploaded chat image (optional spoiler). */
export function buildChatImageMessageContent(publicUrl: string, spoiler: boolean): string {
  const url = publicUrl.trim();
  return spoiler ? `${SPOILER_MEDIA_PREFIX}${url}` : url;
}

/** Parse image/GIF URL payload; `spoiler` is true when user marked the upload as spoiler. */
export function parseChatMediaPayload(value: string): { url: string; spoiler: boolean } | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const spoiler = trimmed.startsWith(SPOILER_MEDIA_PREFIX);
  const rest = spoiler ? trimmed.slice(SPOILER_MEDIA_PREFIX.length).trim() : trimmed;
  if (!isRawChatMediaUrl(rest)) return null;
  return { url: rest, spoiler };
}

/**
 * Stored reply shape: `↪[id:uuid] Name: snippet\\n<body>` or `↪ Name: snippet\\n<body>`.
 * First newline separates the quote line from the user's actual message.
 */
export function splitLeadingReply(content: string): {
  isReply: boolean;
  /** Includes the newline after the quote line when `isReply`. */
  prefix: string;
  /** User-visible body (what they typed / media URL). */
  body: string;
} {
  if (!content.startsWith('↪')) {
    return { isReply: false, prefix: '', body: content };
  }
  const nl = content.indexOf('\n');
  if (nl === -1) {
    return { isReply: true, prefix: content, body: '' };
  }
  return {
    isReply: true,
    prefix: content.slice(0, nl + 1),
    body: content.slice(nl + 1),
  };
}

export function isChatMediaUrl(value: unknown): boolean {
  if (typeof value !== 'string' || !value.trim()) return false;
  return parseChatMediaPayload(value) !== null;
}

/** Plain-text preview for sidebar row (no ids, no quote line clutter). */
export function getSidebarPreviewText(content: unknown): string {
  if (typeof content !== 'string' || !content.trim()) return 'Started a chat';
  if (isGroupLeaveMessage(content)) return 'Left the group';

  const { isReply, body } = splitLeadingReply(content);
  const main = (isReply ? body : content).trim();
  if (!main) return isReply ? 'Reply' : 'Started a chat';

  const v = main.toLowerCase();
  if (main.startsWith(SPOILER_MEDIA_PREFIX)) {
    if (v.includes('.gif')) return isReply ? '↪ GIF (spoiler)' : 'GIF (spoiler)';
    if (/\.(png|jpe?g|webp|bmp|svg|ico)(\?.*)?$/i.test(v)) return isReply ? '↪ Photo (spoiler)' : 'Photo (spoiler)';
  }
  if (v.includes('.gif')) return isReply ? '↪ GIF' : 'GIF';
  if (/\.(png|jpe?g|webp|bmp|svg|ico)(\?.*)?$/i.test(v)) return isReply ? '↪ Photo' : 'Photo';

  const nl = main.indexOf('\n');
  const line = nl === -1 ? main : main.slice(0, nl);
  const max = 72;
  const shortened = line.length > max ? `${line.slice(0, max)}…` : line;
  return isReply ? `↪ ${shortened}` : shortened;
}

/** Short label for the message being replied to (composer / snippets). */
export function getQuotedMessageLabel(content: unknown): string {
  if (typeof content !== 'string' || !content.trim()) return '[message]';
  if (isGroupLeaveMessage(content)) return 'Left the group';

  const { isReply, body } = splitLeadingReply(content);
  const text = (isReply ? body : content).trim();
  if (!text) return '[message]';

  if (isChatMediaUrl(text)) {
    const p = parseChatMediaPayload(text);
    if (!p) return '[image]';
    if (p.spoiler) {
      return p.url.toLowerCase().includes('.gif') ? '[spoiler gif]' : '[spoiler image]';
    }
    return p.url.toLowerCase().includes('.gif') ? '[gif]' : '[image]';
  }
  const nl = text.indexOf('\n');
  const line = nl === -1 ? text : text.slice(0, nl);
  return line.length > 80 ? `${line.slice(0, 80)}...` : line;
}

/** Text shown in desktop notification body (new message only, no reply metadata). */
export function getNotificationMessageBody(content: string): string {
  const { isReply, body } = splitLeadingReply(content);
  const main = (isReply ? body : content).trim();
  const nl = main.indexOf('\n');
  const line = nl === -1 ? main : main.slice(0, nl);
  return line.length > 240 ? `${line.slice(0, 240)}…` : line;
}
