import type { ClassId } from '@regicide/shared';

/**
 * The game's visual language uses these hand-drawn marks instead of platform emoji. Keeping the silhouettes
 * simple means they stay recognizable on a card face, in an immunity chip, and at the small sizes used in the
 * playmat controls.
 */
export type GameIconId = ClassId | 'JESTER' | 'CURSED' | 'CORRUPTED' | 'RESTORED' | 'SPECIAL' | 'FLUTE' | 'WHISTLE' | 'EMBLEM';

export function ClassIcon({ id, className, title }: { id: GameIconId; className?: string; title?: string }) {
  const common = {
    className: `class-icon${className ? ` ${className}` : ''}`,
    viewBox: '0 0 24 24',
    fill: 'none',
    xmlns: 'http://www.w3.org/2000/svg',
    'aria-hidden': title ? undefined : true,
    role: title ? 'img' : undefined,
  };
  const stroke = { stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };

  const art = (() => {
    switch (id) {
      case 'WARRIOR':
        return <><path {...stroke} d="M11 21V3.4" /><path d="M10.7 5.3C6.5 4.3 3.3 6.1 3.3 9.6c0 2.6 1.6 4.7 4.2 5.6 2.4-1.9 3.3-5.1 3.2-9.9Z" fill="currentColor" /><path d="M11.3 5.3c4.2-1 7.4.8 7.4 4.3 0 2.6-1.6 4.7-4.2 5.6-2.4-1.9-3.3-5.1-3.2-9.9Z" fill="currentColor" /><path {...stroke} d="M7.2 21h7.6" /></>;
      case 'BARD':
        return <><path {...stroke} d="M15.5 4.5v11.1" /><path {...stroke} d="M15.5 5.2 20 4v10.2" /><path {...stroke} d="M15.5 8.1 20 6.9" /><circle cx="12" cy="17.7" r="3" fill="currentColor" /><circle cx="16.5" cy="16.2" r="3" fill="currentColor" /></>;
      case 'CLERIC':
        return <path d="M12 20.8 4.7 14C.4 10.1 3.2 3.5 8.2 4.5c1.6.3 2.9 1.3 3.8 2.6.9-1.3 2.2-2.3 3.8-2.6 5-1 7.8 5.6 3.5 9.5L12 20.8Z" fill="currentColor" />;
      case 'PALADIN':
        return <><path d="M12 2.5 19 5v6.1c0 4.7-2.9 8.7-7 10.4-4.1-1.7-7-5.7-7-10.4V5l7-2.5Z" fill="currentColor" /><path d="M12 6v11.1M8.4 11.6H15.6" stroke="#fff7dd" strokeWidth="1.65" strokeLinecap="round" /></>;
      case 'MAGE':
        return <><path d="m12 2.5 6.3 7.3L12 21.5 5.7 9.8 12 2.5Z" fill="currentColor" opacity=".92" /><path d="m12 4.9 3.7 4.7L12 18.1 8.3 9.6 12 4.9Z" fill="#fff7dd" opacity=".62" /><path {...stroke} d="M3.5 5.5 5 4m14 16.5 1.5-1.5M19 5.5 20.5 4M3.5 18.5 5 20" /></>;
      case 'REAVER':
        return <><path {...stroke} d="m7 20 8-8" /><path d="m13.4 4.2 6.4 1.2-1.1 6.4-2.3-2.3-3.1 3.1-2.9-2.9 3.1-3.1-2.4-2.4Z" fill="currentColor" /><path {...stroke} d="m5.4 21.6 2.2-2.2" /></>;
      case 'GUARDIAN':
        return <><path d="M5 5h14v6.2c0 5.2-3.1 8.8-7 10.3-3.9-1.5-7-5.1-7-10.3V5Z" fill="currentColor" /><path d="M8.2 5V2.8m3.8 2.2V2.8m3.8 2.2V2.8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /><path d="M8.2 11.6h7.6M12 8v7.3" stroke="#fff7dd" strokeWidth="1.5" strokeLinecap="round" /></>;
      case 'DRUID':
        return <><path d="M19.8 3.3c-8.3.2-13.6 3.7-14.8 9.6-.7 3.7 1.9 6.7 5.4 6.1 6-1 9.3-6.4 9.4-15.7Z" fill="currentColor" /><path d="M5.4 18.6c3-4.1 6.7-7.1 11.3-9.2" stroke="#fff7dd" strokeWidth="1.55" strokeLinecap="round" /></>;
      case 'CHANTER':
        return <><path {...stroke} d="M12 3.2v11.6" /><path d="M8.2 17.5a3.8 3.8 0 1 0 7.6 0 3.8 3.8 0 0 0-7.6 0Z" fill="currentColor" /><path {...stroke} d="M5.3 8.1c-1.1 1.1-1.1 2.9 0 4m13.4-4c1.1 1.1 1.1 2.9 0 4M3 5.8c-2.4 2.4-2.4 6.1 0 8.5m18-8.5c2.4 2.4 2.4 6.1 0 8.5" /></>;
      case 'EVERGREEN':
        return <><path d="m12 2.2-6 8h3.1L4.8 16h4l-4.1 5.2h14.6L15.2 16h4l-4.3-5.8H18l-6-8Z" fill="currentColor" /><path {...stroke} d="M12 13.4V21" /></>;
      case 'MERCENARY':
        return <><path d="M5.2 7.4 12 3l6.8 4.4v9.2L12 21l-6.8-4.4V7.4Z" fill="currentColor" /><path d="M12 7.1v9.8m-2.6-6.9h5.2" stroke="#fff7dd" strokeWidth="1.55" strokeLinecap="round" /></>;
      case 'JESTER':
        return <><path d="M4.2 8.2 8.7 3l3.3 3.7L15.3 3l4.5 5.2-2.7 3.1v5.5c0 1.5-2.2 2.7-5 2.7s-5-1.2-5-2.7v-5.5L4.2 8.2Z" fill="currentColor" /><path d="M8.4 12.3h.1m7 0h.1" stroke="#fff7dd" strokeWidth="2.1" strokeLinecap="round" /><path d="M9.1 15.7c1.7 1.1 4.1 1.1 5.8 0" stroke="#fff7dd" strokeWidth="1.25" strokeLinecap="round" /></>;
      case 'CURSED':
        return <><path d="M12 2.8 14 8l5.2-2-2 5.2 4.9 1-4.9 1 2 5.2-5.2-2-2 5.2-2-5.2-5.2 2 2-5.2-4.9-1 4.9-1L4.8 6l5.2 2 2-5.2Z" fill="currentColor" /><circle cx="12" cy="12" r="2.1" fill="#fff7dd" /></>;
      case 'CORRUPTED':
        return <><path {...stroke} d="M6 21 18 3M5 8.2c2.8-3.3 7.6-2.8 8.5.5.9 3.2-2.6 5.3-5 6.3-2.5 1-3.5 3-2.5 6M18.6 10.6c-2.8 3.3-7.6 2.8-8.5-.5-.9-3.2 2.6-5.3 5-6.3 2.5-1 3.5-3 2.5-6" /></>;
      case 'RESTORED':
        return <><path d="M12 21c-4.8-2.7-7.7-6.8-7.7-11.4 3.4.1 6.1 1.7 7.7 4.5 1.6-2.8 4.3-4.4 7.7-4.5C19.7 14.2 16.8 18.3 12 21Z" fill="currentColor" /><path d="M12 3v12" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /><path d="m8.8 6.2 3.2-3.3 3.2 3.3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></>;
      case 'SPECIAL':
        return <path d="m12 2.3 1.8 6.3 6.2 1.7-6.2 1.7-1.8 6.3-1.8-6.3-6.2-1.7 6.2-1.7L12 2.3Zm6.2 13.4.7 2.4 2.4.7-2.4.7-.7 2.4-.7-2.4-2.4-.7 2.4-.7.7-2.4Z" fill="currentColor" />;
      case 'FLUTE':
        return <><path {...stroke} d="m3.5 14.5 15.8-6.1" /><path {...stroke} d="m17.2 6.9 3.3 4.1" /><circle cx="7.8" cy="12.9" r=".9" fill="currentColor" /><circle cx="11" cy="11.7" r=".9" fill="currentColor" /><circle cx="14.2" cy="10.5" r=".9" fill="currentColor" /></>;
      case 'WHISTLE':
        return <><path d="M5.2 7.1h9.4c2.5 0 4.6 2.1 4.6 4.6s-2.1 4.6-4.6 4.6h-3.3L5.2 10.2v-3.1Z" fill="currentColor" /><circle cx="14.5" cy="11.7" r="1.7" fill="#fff7dd" /><path {...stroke} d="M5.2 10.2 2.7 12.7" /></>;
      case 'EMBLEM':
        return <><path d="m12 2.8 7.3 4.2v10L12 21.2 4.7 17V7l7.3-4.2Z" fill="currentColor" /><path d="m12 6 3.8 5.8-3.8 6.2-3.8-6.2L12 6Z" fill="#fff7dd" opacity=".72" /></>;
    }
  })();

  return <svg {...common}>{title && <title>{title}</title>}{art}</svg>;
}
