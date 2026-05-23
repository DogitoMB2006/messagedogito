import type { CSSProperties } from 'react';

export interface Decoration {
  id: string;
  name: string;
  description: string;
  cost: number;
  /** Returns inline style to apply to the message bubble. */
  getStyle: (isMe: boolean) => CSSProperties;
  /** Tailwind preview classes for the shop card sample bubble. */
  previewClass: string;
}

export const DECORATIONS: Decoration[] = [
  {
    id: 'neon',
    name: 'Neon',
    description: 'Cyan electric glow',
    cost: 1,
    previewClass: 'shadow-[0_0_8px_3px_rgba(6,182,212,0.85),0_0_20px_6px_rgba(6,182,212,0.35)]',
    getStyle: () => ({
      boxShadow: '0 0 8px 3px rgba(6,182,212,0.85), 0 0 20px 6px rgba(6,182,212,0.35)',
    }),
  },
  {
    id: 'rose',
    name: 'Rose',
    description: 'Soft rose pink glow',
    cost: 2,
    previewClass: 'shadow-[0_0_8px_3px_rgba(244,63,94,0.85),0_0_20px_6px_rgba(244,63,94,0.35)]',
    getStyle: () => ({
      boxShadow: '0 0 8px 3px rgba(244,63,94,0.85), 0 0 20px 6px rgba(244,63,94,0.35)',
    }),
  },
  {
    id: 'galaxy',
    name: 'Galaxy',
    description: 'Multi-color cosmic glow',
    cost: 3,
    previewClass: 'shadow-[0_0_8px_3px_rgba(168,85,247,0.85),0_0_16px_6px_rgba(59,130,246,0.5),0_0_28px_10px_rgba(244,63,94,0.25)]',
    getStyle: () => ({
      boxShadow:
        '0 0 8px 3px rgba(168,85,247,0.85), 0 0 16px 6px rgba(59,130,246,0.5), 0 0 28px 10px rgba(244,63,94,0.25)',
    }),
  },
];

export function getDecorationById(id: string | null | undefined): Decoration | null {
  if (!id) return null;
  return DECORATIONS.find((d) => d.id === id) ?? null;
}
