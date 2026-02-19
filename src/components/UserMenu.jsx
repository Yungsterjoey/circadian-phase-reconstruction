/**
 * UserMenu v7.0.1
 * Status bar account dropdown — Apple HIG + Liquid Glass
 */
import { useState, useRef, useEffect } from 'react';
import { useAuthStore } from '../stores/authStore';
import { User, LogOut, Settings, Crown, ChevronDown } from 'lucide-react';

export default function UserMenu() {
  const [open, setOpen] = useState(false);
  const { user, logout } = useAuthStore();
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const tier = user?.tier || 'free';
  const tierColor = tier === 'sovereign' ? '#a855f7' : tier === 'pro' ? '#3b82f6' : 'rgba(255,255,255,.4)';

  return (
    <div className="um" ref={ref}>
      <button className="um-trigger" onClick={() => setOpen(!open)}>
        <div className="um-avatar" style={{ borderColor: tierColor }}>
          <User size={12} />
        </div>
        <span className="um-name">{user?.name?.split(' ')[0] || 'User'}</span>
        <ChevronDown size={12} style={{ opacity: .5 }} />
      </button>

      {open && (
        <div className="um-dropdown">
          <div className="um-header">
            <div className="um-avatar-lg" style={{ borderColor: tierColor }}>
              <User size={16} />
            </div>
            <div>
              <div className="um-fullname">{user?.name || 'User'}</div>
              <div className="um-email">{user?.email || ''}</div>
            </div>
          </div>
          <div className="um-tier">
            <Crown size={12} style={{ color: tierColor }} />
            <span style={{ color: tierColor, textTransform: 'capitalize' }}>{tier}</span>
          </div>
          <div className="um-divider" />
          <button className="um-item" onClick={() => setOpen(false)}><Settings size={14} /> Settings</button>
          <button className="um-item um-logout" onClick={() => { logout(); window.location.reload(); }}>
            <LogOut size={14} /> Sign Out
          </button>
        </div>
      )}

      <style>{`
.um{position:relative}
.um-trigger{display:flex;align-items:center;gap:6px;padding:4px 8px;background:none;border:none;border-radius:8px;color:rgba(255,255,255,.7);font-size:12px;font-family:inherit;cursor:pointer;transition:all .15s}
.um-trigger:hover{background:rgba(255,255,255,.06)}
.um-avatar{width:20px;height:20px;display:flex;align-items:center;justify-content:center;border-radius:50%;border:1.5px solid;background:rgba(255,255,255,.06);color:rgba(255,255,255,.6)}
.um-name{max-width:80px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.um-dropdown{position:absolute;top:calc(100% + 8px);right:0;width:240px;background:rgba(18,18,24,.92);backdrop-filter:blur(60px) saturate(1.6);-webkit-backdrop-filter:blur(60px) saturate(1.6);border:1px solid rgba(255,255,255,.07);border-radius:16px;padding:8px;box-shadow:0 16px 48px rgba(0,0,0,.5);z-index:1000;animation:umIn .2s ease}
@keyframes umIn{from{opacity:0;transform:translateY(-6px) scale(.97)}to{opacity:1;transform:translateY(0) scale(1)}}
.um-header{display:flex;align-items:center;gap:10px;padding:10px 8px}
.um-avatar-lg{width:32px;height:32px;display:flex;align-items:center;justify-content:center;border-radius:50%;border:2px solid;background:rgba(255,255,255,.06);color:rgba(255,255,255,.6);flex-shrink:0}
.um-fullname{font-size:13px;font-weight:600;color:rgba(255,255,255,.9)}
.um-email{font-size:11px;color:rgba(255,255,255,.36);overflow:hidden;text-overflow:ellipsis;max-width:170px}
.um-tier{display:flex;align-items:center;gap:6px;padding:6px 8px;margin:4px 0;font-size:12px;font-weight:500}
.um-divider{height:1px;background:rgba(255,255,255,.06);margin:4px 0}
.um-item{display:flex;align-items:center;gap:10px;width:100%;padding:10px 8px;background:none;border:none;border-radius:8px;color:rgba(255,255,255,.6);font-size:13px;font-family:inherit;cursor:pointer;transition:all .15s}
.um-item:hover{background:rgba(255,255,255,.04);color:rgba(255,255,255,.9)}
.um-logout:hover{color:#ff375f}
      `}</style>
    </div>
  );
}
