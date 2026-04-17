/**
 * PayNav: hovering two-button glass dock at the bottom of every KUROPay screen.
 *   [ ← Back ]                        [ Next → ]
 * Labels & handlers come from usePayNavState (set by each screen via usePayNav).
 * When a button has no onClick, it renders disabled/greyed but stays visible
 * for visual consistency across screens.
 */
import React from 'react';
import { usePayNavState } from './PayNavContext.jsx';

function ArrowLeft() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M10 3.5 5.5 8 10 12.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
}
function ArrowRight() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M6 3.5 10.5 8 6 12.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
}
function Spinner() {
  return <span className="kp-nav-spin" aria-hidden="true" />;
}

export default function PayNav() {
  const { back, next } = usePayNavState();
  const backActive = typeof back?.onClick === 'function';
  const nextActive = typeof next?.onClick === 'function' && !next?.loading;
  const nextVariant = next?.variant || 'primary';

  return (
    <div className="kp-nav-dock" role="toolbar" aria-label="KUROPay navigation">
      <button
        type="button"
        className="kp-nav-btn kp-nav-back"
        onClick={backActive ? back.onClick : undefined}
        disabled={!backActive}
        aria-disabled={!backActive}
      >
        <ArrowLeft />
        <span>{back?.label || 'Back'}</span>
      </button>
      <button
        type="button"
        className={`kp-nav-btn kp-nav-next kp-nav-${nextVariant}`}
        onClick={nextActive ? next.onClick : undefined}
        disabled={!nextActive}
        aria-disabled={!nextActive}
      >
        {next?.loading ? <Spinner /> : null}
        <span>{next?.label || 'Next'}</span>
        {!next?.loading ? <ArrowRight /> : null}
      </button>
    </div>
  );
}
