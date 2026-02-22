/**
 * KURO Icon Registry — maps app IDs and icon names to SVG icons.
 * Use: <KuroIcon name="kuro.chat" size={24} /> or <KuroIcon name="lock" size={24} />
 * Fallback: renders a generic square if no mapping exists (never falls back to emoji).
 */
import React from 'react';

// Minimal SVG icon paths (viewBox 0 0 24 24, stroke-based, Feather-style)
const ICON_PATHS = {
  /* ── App icons ── */
  chat:     'M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z',
  files:    'M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z',
  terminal: 'M4 17l6-5-6-5M12 19h8',
  sandbox:  'M9 3H5a2 2 0 0 0-2 2v4m6-6h10a2 2 0 0 1 2 2v4M9 3v18m0 0h10a2 2 0 0 0 2-2V9M9 21H5a2 2 0 0 1-2-2V9m0 0h18',
  settings: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z',
  about:    'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm0 5v2m0 4h.01',
  vision:   'M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8zM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z',
  browser:  'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zM2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z',
  paxsilica:'M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z',
  auth:     'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z',
  admin:    'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10zM12 8v4m0 4h.01',
  git:      'M6 3a2 2 0 1 0 0 4 2 2 0 0 0 0-4zm12 5a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM6 21a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM6 7v10M6 9c4 0 12-1 12 3v3',

  /* ── UI / system icons ── */
  lock:         'M19 11H5a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7a2 2 0 0 0-2-2zM7 11V7a5 5 0 0 1 10 0v4',
  shield:       'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z',
  install:      'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3',
  copy:         'M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2M9 2h6a1 1 0 0 1 1 1v2a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1z',
  mail:         'M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2zM22 6l-10 7L2 6',
  bolt:         'M13 2L3 14h9l-1 8 10-12h-9l1-8z',
  desktop:      'M20 3H4a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2zM8 21h8M12 17v4',
  agent:        'M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M12 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8z',
  library:      'M4 19.5A2.5 2.5 0 0 1 6.5 17H20M4 4.5A2.5 2.5 0 0 1 6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15z',
  close:        'M18 6L6 18M6 6l12 12',
  'chevron-up': 'M18 15l-6-6-6 6',
  'chevron-down':'M6 9l6 6 6-6',
};

// Emoji → icon key (legacy compatibility — do not use emoji in new code)
const EMOJI_MAP = {
  '💬': 'chat',  '📁': 'files',   '⌨️': 'terminal', '🧪': 'sandbox',
  '⚙️': 'settings', '🔮': 'about', '🎨': 'vision',  '🌐': 'browser',
  '🔧': 'paxsilica', '🔐': 'auth', '🛡️': 'admin',
  // New mappings
  '🔀': 'git',
  '🔒': 'lock',  '🛡': 'shield',
  '💾': 'install', '⌘': 'copy',
  '✉': 'mail',   '⚡': 'bolt',
  '🖥': 'desktop', '🖥️': 'desktop',
  '🤖': 'agent', '📚': 'library',
  '✕': 'close',  '×': 'close',
};

// App ID → icon key
const APP_MAP = {
  'kuro.chat': 'chat',       'kuro.files': 'files',    'kuro.terminal': 'terminal',
  'kuro.sandbox': 'sandbox', 'kuro.settings': 'settings', 'kuro.about': 'about',
  'kuro.vision': 'vision',   'kuro.browser': 'browser', 'kuro.paxsilica': 'paxsilica',
  'kuro.auth': 'auth',       'kuro.admin': 'admin',     'kuro.git': 'git',
};

export default function KuroIcon({ name, size = 20, color = 'currentColor', className = '', style = {} }) {
  const key = APP_MAP[name] || EMOJI_MAP[name] || name;
  const path = ICON_PATHS[key];

  if (!path) {
    // Fallback: generic square placeholder — never renders emoji
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
        stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
        className={className} style={style}>
        <rect x="3" y="3" width="18" height="18" rx="3" />
      </svg>
    );
  }

  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
      className={className} style={style}>
      <path d={path} />
    </svg>
  );
}

// Helper: resolve emoji/appId to icon key
export function resolveIconKey(emojiOrAppId) {
  return APP_MAP[emojiOrAppId] || EMOJI_MAP[emojiOrAppId] || null;
}

export { ICON_PATHS, EMOJI_MAP, APP_MAP };
