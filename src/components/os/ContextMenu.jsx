/**
 * KURO OS — Context Menu
 *
 * Single glass plane. Spawned by long-press or right-click on any app icon.
 * Actions: Open, Pin/Unpin, Close, Edit Home Screen.
 * Clamps to viewport edges. Keyboard accessible.
 *
 * All hooks are unconditional — guard is placed after hooks per Rules of Hooks.
 */

import React, { useEffect, useRef, useCallback } from 'react';
import { useOSStore } from '../../stores/osStore';
import { useAuthStore } from '../../stores/authStore';
import KuroIcon from '../KuroIcon';

// Measured: header(48) + divider(5) + 4 items(160) + separator(5) + 1 item(40) + padding(8) ≈ 266
const MENU_W = 220;
const MENU_H = 270;
const MARGIN  = 12;

export default function ContextMenu() {
  const {
    contextMenu, apps, openApps, pinnedApps,
    closeContextMenu, openApp, closeApp, pinApp, unpinApp, toggleEditMode,
  } = useOSStore();
  const { user } = useAuthStore();

  // All refs and hooks MUST be unconditional (before any early return)
  const menuRef  = useRef(null);
  const firstRef = useRef(null);

  // Focus first item whenever the menu opens (contextMenu changes to non-null)
  useEffect(() => {
    if (!contextMenu) return;
    // Small delay so the element is painted before focus
    const t = setTimeout(() => firstRef.current?.focus(), 16);
    return () => clearTimeout(t);
  }, [contextMenu]);

  // Keyboard: Escape closes, arrow keys move focus
  useEffect(() => {
    if (!contextMenu) return;
    const onKey = (e) => {
      if (e.key === 'Escape') { e.stopPropagation(); closeContextMenu(); return; }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const items = menuRef.current?.querySelectorAll('[role="menuitem"]');
        if (!items?.length) return;
        const idx = Array.from(items).indexOf(document.activeElement);
        const next = e.key === 'ArrowDown'
          ? (idx + 1) % items.length
          : (idx - 1 + items.length) % items.length;
        items[next]?.focus();
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [contextMenu, closeContextMenu]);

  const action = useCallback((fn) => () => { fn(); closeContextMenu(); }, [closeContextMenu]);

  // Guard AFTER all hooks — safe per Rules of Hooks
  if (!contextMenu) return null;

  const { appId, x, y } = contextMenu;
  const app      = apps.find(a => a.id === appId);
  const isOpen   = openApps.includes(appId);
  const isPinned = pinnedApps.includes(appId);

  // Clamp position to viewport
  const vw = typeof window !== 'undefined' ? window.innerWidth  : 400;
  const vh = typeof window !== 'undefined' ? window.innerHeight : 800;
  // Prefer above icon; fall back to below if not enough room
  const rawY     = y - MENU_H - 8;
  const clampedX = Math.min(Math.max(x - MENU_W / 2, MARGIN), vw - MENU_W - MARGIN);
  const clampedY = rawY < MARGIN ? Math.min(y + 8, vh - MENU_H - MARGIN) : Math.max(rawY, MARGIN);

  const items = [
    {
      label: isOpen ? 'Focus' : 'Open',
      icon: 'arrow-right',
      handler: action(() => openApp(appId)),
    },
    isPinned
      ? { label: 'Unpin from Dock', icon: 'close',   handler: action(() => unpinApp(appId)) }
      : { label: 'Pin to Dock',     icon: 'install',  handler: action(() => pinApp(appId)) },
    isOpen && {
      label: 'Close',
      icon: 'close',
      handler: action(() => closeApp(appId)),
      destructive: true,
    },
    { separator: true },
    {
      label: 'Edit Home Screen',
      icon: 'settings',
      handler: action(() => toggleEditMode()),
    },
  ].filter(Boolean);

  return (
    <>
      {/* Backdrop — closes menu on tap */}
      <div
        className="cm-backdrop"
        onClick={closeContextMenu}
        aria-hidden="true"
      />

      <div
        ref={menuRef}
        className="cm-panel lg-regular"
        role="menu"
        aria-label={`Actions for ${app?.name || appId}`}
        style={{ left: clampedX, top: clampedY, width: MENU_W }}
      >
        {/* App header */}
        <div className="cm-header" aria-hidden="true">
          <span className="cm-app-icon">
            <KuroIcon name={appId} size={18} color="rgba(255,255,255,0.8)" />
          </span>
          <span className="cm-app-name">{app?.name || appId}</span>
        </div>
        <div className="cm-divider" role="separator" />

        {/* Actions */}
        {items.map((item, i) =>
          item.separator ? (
            <div key={`sep-${i}`} className="cm-divider" role="separator" />
          ) : (
            <button
              key={item.label}
              ref={i === 0 ? firstRef : null}
              role="menuitem"
              className={`cm-item${item.destructive ? ' cm-destructive' : ''}`}
              onClick={item.handler}
              tabIndex={0}
            >
              <span className="cm-item-icon" aria-hidden="true">
                <KuroIcon name={item.icon} size={14} color={item.destructive ? 'rgba(255,59,48,0.9)' : 'rgba(255,255,255,0.6)'} />
              </span>
              <span className="cm-item-label">{item.label}</span>
            </button>
          )
        )}
      </div>

      <style>{`
        .cm-backdrop {
          position: fixed; inset: 0; z-index: 999;
          background: transparent; cursor: default;
        }
        .cm-panel {
          position: fixed; z-index: 1000;
          border-radius: var(--kuro-os-menu-radius, 14px) !important;
          overflow: hidden;
          box-shadow:
            0 8px 32px -4px rgba(0,0,0,0.55),
            0 2px 8px rgba(0,0,0,0.3),
            inset 0 1px 0 rgba(255,255,255,0.12);
          animation: cm-open 150ms var(--lg-ease-decelerate, cubic-bezier(0,0,0.2,1)) forwards;
        }
        @keyframes cm-open {
          from { opacity: 0; transform: scale(0.95) translateY(-4px); }
          to   { opacity: 1; transform: scale(1) translateY(0); }
        }
        @media (prefers-reduced-motion: reduce) { .cm-panel { animation: none; } }
        .cm-header {
          display: flex; align-items: center; gap: 8px; padding: 10px 14px 8px;
        }
        .cm-app-icon {
          display: flex; align-items: center; justify-content: center;
          width: 28px; height: 28px; border-radius: 8px;
          background: rgba(255,255,255,0.06); flex-shrink: 0;
        }
        .cm-app-name {
          font-size: 12px; font-weight: 600; color: rgba(255,255,255,0.75);
          white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
        }
        .cm-divider {
          height: 1px;
          background: var(--kuro-os-menu-separator, rgba(255,255,255,0.06));
          margin: 2px 0;
        }
        .cm-item {
          display: flex; align-items: center; gap: 10px;
          width: 100%; height: var(--kuro-os-menu-item-h, 40px);
          padding: 0 14px; background: none; border: none;
          cursor: pointer; text-align: left; transition: background 100ms;
          color: rgba(255,255,255,0.85); font-size: 13px; font-family: inherit;
        }
        .cm-item:hover { background: var(--kuro-os-menu-item-hover, rgba(255,255,255,0.06)); }
        .cm-item:focus-visible { outline: none; background: rgba(168,85,247,0.12); }
        .cm-item.cm-destructive { color: rgba(255,59,48,0.9); }
        .cm-item-icon { display: flex; align-items: center; flex-shrink: 0; }
        .cm-item-label { flex: 1; }
      `}</style>
    </>
  );
}
