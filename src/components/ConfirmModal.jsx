/**
 * ConfirmModal v7.0.1
 * System-level confirmation dialog — Apple HIG + Liquid Glass
 */
import { useOSStore } from '../stores/osStore';

export default function ConfirmModal() {
  const { activeModal } = useOSStore();
  if (!activeModal) return null;

  const { title, message, onConfirm, onCancel } = activeModal;

  return (
    <div className="cm-backdrop" onClick={onCancel}>
      <div className="cm" onClick={e => e.stopPropagation()}>
        <h3 className="cm-title">{title || 'Confirm'}</h3>
        <p className="cm-msg">{message || 'Are you sure?'}</p>
        <div className="cm-actions">
          <button className="cm-btn cm-cancel" onClick={onCancel}>Cancel</button>
          <button className="cm-btn cm-confirm" onClick={onConfirm}>Confirm</button>
        </div>

        <style>{`
.cm-backdrop{position:fixed;inset:0;z-index:1000;background:rgba(0,0,0,.5);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);display:flex;align-items:center;justify-content:center;animation:cmFade .2s ease}
@keyframes cmFade{from{opacity:0}to{opacity:1}}
.cm{width:100%;max-width:340px;margin:16px;padding:24px;background:rgba(18,18,24,.92);backdrop-filter:blur(60px) saturate(1.6);-webkit-backdrop-filter:blur(60px) saturate(1.6);border:1px solid rgba(255,255,255,.07);border-radius:22px;box-shadow:0 20px 48px rgba(0,0,0,.5);animation:cmScale .25s cubic-bezier(.175,.885,.32,1.275) both;position:relative;overflow:hidden}
.cm::before{content:'';position:absolute;top:0;left:0;right:0;height:1px;background:linear-gradient(90deg,transparent,rgba(255,255,255,.06) 30%,rgba(255,255,255,.06) 70%,transparent)}
@keyframes cmScale{from{opacity:0;transform:scale(.92)}to{opacity:1;transform:scale(1)}}
.cm-title{font-size:16px;font-weight:600;color:rgba(255,255,255,.9);margin:0 0 8px}
.cm-msg{font-size:14px;color:rgba(255,255,255,.5);margin:0 0 20px;line-height:1.5}
.cm-actions{display:flex;gap:8px;justify-content:flex-end}
.cm-btn{padding:10px 20px;border:none;border-radius:12px;font-size:14px;font-weight:500;font-family:inherit;cursor:pointer;transition:all .15s}
.cm-cancel{background:rgba(255,255,255,.04);color:rgba(255,255,255,.6)}
.cm-cancel:hover{background:rgba(255,255,255,.06)}
.cm-confirm{background:linear-gradient(135deg,#a855f7,#6366f1);color:white}
.cm-confirm:hover{filter:brightness(1.08)}
        `}</style>
      </div>
    </div>
  );
}
