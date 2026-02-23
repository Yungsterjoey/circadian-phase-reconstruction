/**
 * KURO OS — Home Screen
 *
 * iOS/iPadOS-style app grid with:
 *   - Responsive columns (6/5/4 for desktop/tablet/mobile)
 *   - Long-press → context menu
 *   - Edit mode: icon wobble + drag-to-reorder
 *   - Keyboard navigation (arrows, Enter, Shift+F10)
 *   - Tier-gating with lock badges
 *   - Open indicators (purple dot)
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useOSStore } from '../../stores/osStore';
import { useAuthStore } from '../../stores/authStore';
import KuroIcon from '../KuroIcon';

// ── Long-press threshold ─────────────────────────────────────────────────────
const LONG_PRESS_MS     = 500;
const DRAG_CANCEL_PX    = 5;   // movement during long-press cancels it
const DRAG_THRESHOLD_PX = 8;   // movement after long-press activates drag (mouse)
const DRAG_THRESHOLD_TOUCH = 12;

// ── Tier labels ──────────────────────────────────────────────────────────────
const TIER_LABEL = { pro: 'PRO', sovereign: 'SOV' };

// ── Icon container ──────────────────────────────────────────────────────────
function AppIcon({ app, isOpen, isLocked, isAdmin, editMode, onOpen, onContextMenu, onDragStart, onDragOver, onDrop, isDragOver }) {
  const pressTimer   = useRef(null);
  const pressOrigin  = useRef(null);
  const cancelled    = useRef(false);

  const startLongPress = useCallback((clientX, clientY) => {
    cancelled.current = false;
    pressOrigin.current = { x: clientX, y: clientY };
    pressTimer.current = setTimeout(() => {
      if (!cancelled.current) {
        // Trigger context menu at icon position
        const el = document.getElementById(`app-icon-${app.id}`);
        if (el) {
          const r = el.getBoundingClientRect();
          onContextMenu(app.id, r.left + r.width / 2, r.top);
        }
      }
    }, LONG_PRESS_MS);
  }, [app.id, onContextMenu]);

  const cancelLongPress = useCallback(() => {
    cancelled.current = true;
    clearTimeout(pressTimer.current);
  }, []);

  const checkCancel = useCallback((clientX, clientY) => {
    if (!pressOrigin.current) return;
    const dx = Math.abs(clientX - pressOrigin.current.x);
    const dy = Math.abs(clientY - pressOrigin.current.y);
    if (dx > DRAG_CANCEL_PX || dy > DRAG_CANCEL_PX) cancelLongPress();
  }, [cancelLongPress]);

  const handleMouseDown = (e) => {
    if (e.button !== 0) return;
    startLongPress(e.clientX, e.clientY);
  };
  const handleMouseMove  = (e) => checkCancel(e.clientX, e.clientY);
  const handleMouseUp    = () => cancelLongPress();
  const handleTouchStart = (e) => {
    const t = e.touches[0];
    startLongPress(t.clientX, t.clientY);
  };
  const handleTouchMove = (e) => {
    const t = e.touches[0];
    checkCancel(t.clientX, t.clientY);
  };
  const handleTouchEnd   = () => cancelLongPress();

  const handleClick = (e) => {
    e.stopPropagation();
    cancelLongPress();
    if (!isLocked) onOpen(app.id);
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (!isLocked) onOpen(app.id); }
    if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) {
      e.preventDefault();
      const el = document.getElementById(`app-icon-${app.id}`);
      if (el) { const r = el.getBoundingClientRect(); onContextMenu(app.id, r.left + r.width / 2, r.top); }
    }
  };

  const handleContextMenu = (e) => {
    e.preventDefault();
    onContextMenu(app.id, e.clientX, e.clientY);
  };

  // Edit-mode drag handlers
  const handleDragStart = editMode ? (e) => onDragStart(e, app.id) : undefined;
  const handleDragOver  = editMode ? (e) => onDragOver(e, app.id) : undefined;
  const handleDropEvt   = editMode ? (e) => onDrop(e, app.id) : undefined;

  return (
    <div
      className={`hs-icon-cell${isDragOver ? ' hs-drag-over' : ''}`}
      id={`app-icon-${app.id}`}
    >
      <button
        className={[
          'hs-icon-btn',
          editMode  ? 'hs-editing' : '',
          isLocked  ? 'hs-locked'  : '',
          isOpen    ? 'hs-open'    : '',
        ].filter(Boolean).join(' ')}
        aria-label={`${app.name}${isLocked ? ' (locked)' : ''}${isOpen ? ' (open)' : ''}`}
        aria-pressed={isOpen}
        tabIndex={0}
        draggable={editMode}
        onClick={handleClick}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onContextMenu={handleContextMenu}
        onKeyDown={handleKeyDown}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDrop={handleDropEvt}
      >
        <span className="hs-icon-bg" aria-hidden="true">
          <KuroIcon name={app.id} size={28} color={isLocked ? 'rgba(255,255,255,0.3)' : 'rgba(255,255,255,0.85)'} />
        </span>
        {isLocked && app.minTier !== 'free' && (
          <span className="hs-lock-badge" aria-hidden="true">
            {TIER_LABEL[app.minTier] || ''}
          </span>
        )}
        {isOpen && !isLocked && (
          <span className="hs-open-dot" aria-hidden="true" />
        )}
      </button>
      <span className="hs-icon-label" aria-hidden="true">{app.name}</span>
    </div>
  );
}

// ── Edit mode "Done" button ─────────────────────────────────────────────────
function EditDoneButton({ onDone }) {
  return (
    <button className="hs-edit-done" onClick={onDone} aria-label="Done editing home screen">
      Done
    </button>
  );
}

// ── Main HomeScreen ─────────────────────────────────────────────────────────
export default function HomeScreen() {
  const {
    apps, appOrder, openApps, editMode,
    openApp, openContextMenu, setAppOrder, toggleEditMode, exitEditMode, contextMenu,
  } = useOSStore();
  const { user } = useAuthStore();

  const [dragSource, setDragSource] = useState(null);
  const [dragTarget, setDragTarget] = useState(null);

  // Keyboard navigation: track focused icon index
  const [focusedIndex, setFocusedIndex] = useState(0);
  const gridRef = useRef(null);

  // Compute ordered, visible app list (exclude admin unless isAdmin)
  const visibleApps = appOrder
    .map(id => apps.find(a => a.id === id))
    .filter(Boolean)
    .filter(app => app.id !== 'kuro.admin' || user?.isAdmin);

  const getIsLocked = (app) => {
    if (!user) return true; // not authenticated
    const TIER_LEVEL = { free: 0, pro: 1, sovereign: 2 };
    return (TIER_LEVEL[user.tier] || 0) < (TIER_LEVEL[app.minTier] || 0);
  };

  const handleOpen = useCallback((appId) => {
    if (!user) return; // auth guard handled upstream
    openApp(appId);
  }, [openApp, user]);

  const handleContextMenu = useCallback((appId, x, y) => {
    openContextMenu(appId, x, y);
  }, [openContextMenu]);

  // ── Drag reorder ──────────────────────────────────────────────────────────
  const handleDragStart = (e, appId) => {
    e.dataTransfer.effectAllowed = 'move';
    setDragSource(appId);
  };
  const handleDragOver = (e, appId) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (appId !== dragSource) setDragTarget(appId);
  };
  const handleDrop = (e, targetId) => {
    e.preventDefault();
    if (!dragSource || dragSource === targetId) { setDragSource(null); setDragTarget(null); return; }
    const newOrder = [...appOrder];
    const fromIdx = newOrder.indexOf(dragSource);
    const toIdx   = newOrder.indexOf(targetId);
    if (fromIdx < 0 || toIdx < 0) { setDragSource(null); setDragTarget(null); return; }
    newOrder.splice(fromIdx, 1);
    newOrder.splice(toIdx, 0, dragSource);
    setAppOrder(newOrder);
    setDragSource(null);
    setDragTarget(null);
  };
  const handleDragEnd = () => { setDragSource(null); setDragTarget(null); };

  // ── Keyboard navigation ───────────────────────────────────────────────────
  const handleGridKeyDown = (e) => {
    const cols = window.innerWidth >= 1024 ? 6 : window.innerWidth >= 768 ? 5 : 4;
    const total = visibleApps.length;
    let next = focusedIndex;
    if (e.key === 'ArrowRight') next = Math.min(focusedIndex + 1, total - 1);
    if (e.key === 'ArrowLeft')  next = Math.max(focusedIndex - 1, 0);
    if (e.key === 'ArrowDown')  next = Math.min(focusedIndex + cols, total - 1);
    if (e.key === 'ArrowUp')    next = Math.max(focusedIndex - cols, 0);
    if (next !== focusedIndex) {
      e.preventDefault();
      setFocusedIndex(next);
      const btn = gridRef.current?.querySelectorAll('.hs-icon-btn')[next];
      btn?.focus();
    }
    if (e.key === 'Escape' && editMode) { e.preventDefault(); exitEditMode(); }
  };

  // Click on background exits edit mode
  const handleBgClick = () => { if (editMode) exitEditMode(); };

  // Long-press on background enters edit mode
  const bgPressTimer = useRef(null);
  const bgPressOrigin = useRef(null);
  const handleBgMouseDown = (e) => {
    if (e.target !== e.currentTarget) return; // only bare background
    bgPressOrigin.current = { x: e.clientX, y: e.clientY };
    bgPressTimer.current = setTimeout(() => toggleEditMode(), LONG_PRESS_MS);
  };
  const handleBgMouseMove = (e) => {
    if (!bgPressOrigin.current) return;
    const dx = Math.abs(e.clientX - bgPressOrigin.current.x);
    const dy = Math.abs(e.clientY - bgPressOrigin.current.y);
    if (dx > DRAG_CANCEL_PX || dy > DRAG_CANCEL_PX) clearTimeout(bgPressTimer.current);
  };
  const handleBgMouseUp = () => clearTimeout(bgPressTimer.current);

  // Close context menu on background click
  const { closeContextMenu } = useOSStore();
  const handleOutsideClick = (e) => {
    if (contextMenu) { closeContextMenu(); return; }
    handleBgClick();
  };

  return (
    <div
      className="hs-root"
      onMouseDown={handleBgMouseDown}
      onMouseMove={handleBgMouseMove}
      onMouseUp={handleBgMouseUp}
      onClick={handleOutsideClick}
      aria-label="Home Screen"
      role="region"
    >
      {editMode && <EditDoneButton onDone={exitEditMode} />}

      <div
        className="hs-grid"
        ref={gridRef}
        role="grid"
        aria-label="App grid"
        onKeyDown={handleGridKeyDown}
        onDragEnd={handleDragEnd}
      >
        {visibleApps.map((app, idx) => (
          <AppIcon
            key={app.id}
            app={app}
            isOpen={openApps.includes(app.id)}
            isLocked={getIsLocked(app)}
            editMode={editMode}
            onOpen={handleOpen}
            onContextMenu={handleContextMenu}
            onDragStart={handleDragStart}
            onDragOver={handleDragOver}
            onDrop={handleDrop}
            isDragOver={dragTarget === app.id && dragSource !== app.id}
          />
        ))}
      </div>

      <style>{`
        /* ── Home Screen Root ────────────────────────────────────── */
        .hs-root {
          flex: 1;
          overflow-y: auto;
          padding: 32px 24px 120px;
          -webkit-overflow-scrolling: touch;
          overscroll-behavior: contain;
        }

        /* ── Grid ──────────────────────────────────────────────────── */
        .hs-grid {
          display: grid;
          grid-template-columns: repeat(6, 1fr);
          gap: var(--kuro-os-icon-gap, 20px);
          max-width: 900px;
          margin: 0 auto;
        }
        @media (max-width: 1023px) { .hs-grid { grid-template-columns: repeat(5, 1fr); } }
        @media (max-width: 767px)  { .hs-grid { grid-template-columns: repeat(4, 1fr); gap: 12px; padding: 16px 12px 100px; } }

        /* ── Icon cell ─────────────────────────────────────────────── */
        .hs-icon-cell {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 6px;
          transition: transform 200ms var(--lg-ease-spring, cubic-bezier(0.34,1.56,0.64,1));
        }
        .hs-drag-over { transform: translateX(4px) scale(0.96); }

        /* ── Icon button ───────────────────────────────────────────── */
        .hs-icon-btn {
          position: relative;
          width: var(--kuro-os-icon-size, 56px);
          height: var(--kuro-os-icon-size, 56px);
          min-width: 44px; min-height: 44px; /* HIG touch target */
          border: none;
          border-radius: var(--kuro-os-icon-radius, 14px);
          background: var(--kuro-os-icon-bg, rgba(255,255,255,0.06));
          border: 1px solid var(--kuro-os-icon-border, rgba(255,255,255,0.08));
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          transition:
            background 150ms var(--lg-ease-standard),
            transform  150ms var(--lg-ease-standard),
            box-shadow 150ms var(--lg-ease-standard);
          -webkit-tap-highlight-color: transparent;
          outline: none;
        }
        .hs-icon-btn:hover {
          background: var(--kuro-os-icon-hover, rgba(255,255,255,0.10));
          transform: scale(1.04);
        }
        .hs-icon-btn:active { transform: scale(0.94); }
        .hs-icon-btn:focus-visible {
          outline: 2px solid var(--lg-accent, #a855f7);
          outline-offset: 2px;
        }

        /* ── Edit mode wobble ──────────────────────────────────────── */
        @keyframes hs-wobble {
          0%,100% { transform: rotate(-1deg); }
          50%      { transform: rotate(1deg); }
        }
        .hs-icon-btn.hs-editing {
          animation: hs-wobble 300ms linear infinite;
          cursor: grab;
        }
        .hs-icon-btn.hs-editing:active { cursor: grabbing; }
        @media (prefers-reduced-motion: reduce) {
          .hs-icon-btn.hs-editing {
            animation: none;
            outline: 2px solid var(--lg-accent, #a855f7);
          }
        }

        /* ── Locked icon ───────────────────────────────────────────── */
        .hs-icon-btn.hs-locked { opacity: 0.45; cursor: default; }
        .hs-lock-badge {
          position: absolute;
          bottom: -4px; right: -4px;
          font-size: 8px;
          font-weight: 700;
          letter-spacing: 0.5px;
          background: rgba(168,85,247,0.85);
          color: #fff;
          padding: 1px 4px;
          border-radius: 4px;
          pointer-events: none;
        }

        /* ── Open indicator ────────────────────────────────────────── */
        .hs-open-dot {
          position: absolute;
          bottom: -8px; left: 50%;
          transform: translateX(-50%);
          width: var(--kuro-os-indicator-size, 6px);
          height: var(--kuro-os-indicator-size, 6px);
          border-radius: 50%;
          background: var(--kuro-os-indicator-color, #a855f7);
        }

        /* ── Icon background ───────────────────────────────────────── */
        .hs-icon-bg {
          display: flex;
          align-items: center;
          justify-content: center;
          width: 100%; height: 100%;
          border-radius: inherit;
          pointer-events: none;
        }

        /* ── Label ─────────────────────────────────────────────────── */
        .hs-icon-label {
          font-size: var(--kuro-os-label-size, 11px);
          color: var(--kuro-os-label-color, rgba(255,255,255,0.75));
          text-align: center;
          max-width: 72px;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          line-height: 1.3;
          user-select: none;
          pointer-events: none;
        }

        /* ── Edit Done button ──────────────────────────────────────── */
        .hs-edit-done {
          position: fixed;
          top: 16px; right: 20px;
          z-index: 800;
          padding: 8px 20px;
          background: var(--lg-glass-bg, rgba(255,255,255,0.08));
          border: 1px solid var(--lg-glass-border, rgba(255,255,255,0.12));
          border-radius: 20px;
          color: var(--lg-accent, #a855f7);
          font-size: 13px;
          font-weight: 600;
          cursor: pointer;
          backdrop-filter: blur(16px);
          -webkit-backdrop-filter: blur(16px);
          transition: background 150ms;
        }
        .hs-edit-done:hover { background: rgba(168,85,247,0.12); }
        .hs-edit-done:focus-visible { outline: 2px solid var(--lg-accent, #a855f7); outline-offset: 2px; }
      `}</style>
    </div>
  );
}
