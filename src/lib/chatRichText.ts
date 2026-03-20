import twemoji from 'twemoji';

const TWEMOJI_BASE = 'https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/';

const LINK_CLASS =
  'text-blue-600 underline underline-offset-2 hover:text-blue-500 dark:text-blue-400 dark:hover:text-blue-300 break-all font-medium';

export function escapeHtml(unsafe: string): string {
  return unsafe
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * Turn http(s) and www. URLs into anchors. Input must already be HTML-escaped.
 * Call before `twemoji.parse` so img `src` attributes are not linkified.
 */
export function linkifyEscapedChatHtml(escaped: string): string {
  const trimTrailing = (raw: string): [string, string] => {
    let main = raw;
    let tail = '';
    while (main.length > 0 && '.,;:!?'.includes(main[main.length - 1])) {
      tail = main.slice(-1) + tail;
      main = main.slice(0, -1);
    }
    return [main, tail];
  };

  return escaped.replace(/\b(https?:\/\/[^\s<]+|www\.[^\s<]+)/gi, (full) => {
    const [main, tail] = trimTrailing(full);
    if (!main) return full;
    if (main.startsWith('www.') && !main.includes('.', 4)) return full;
    const isWww = !/^https?:\/\//i.test(main);
    const href = isWww ? `https://${main}` : main;
    return `<a href="${href}" target="_blank" rel="noopener noreferrer" class="${LINK_CLASS}">${main}</a>${tail}`;
  });
}

export function formatChatMessageHtml(
  text: string,
  options?: { multilineBreaks?: boolean; emoji?: boolean },
): string {
  const multiline = options?.multilineBreaks ?? true;
  const emoji = options?.emoji ?? true;

  let safe = escapeHtml(text);
  if (multiline) {
    safe = safe.replace(/\n/g, '<br/>').replace(/ {2}/g, ' &nbsp;');
  }
  safe = linkifyEscapedChatHtml(safe);
  if (!emoji) return safe;
  return twemoji.parse(safe, {
    folder: 'svg',
    ext: '.svg',
    base: TWEMOJI_BASE,
  });
}
