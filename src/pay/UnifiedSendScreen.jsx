import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import jsQR from 'jsqr';
import { detect, initiatePayment, initiateATMPayment, getFxRate, warmCard, fetchCards, fetchPolicy } from './api.js';
import { usePayNav } from './nav/PayNavContext.jsx';

const RAIL_LABELS = {
  vietqr:    { name: 'VietQR',   flag: '🇻🇳', currency: 'VND' },
  promptpay: { name: 'PromptPay', flag: '🇹🇭', currency: 'THB' },
  qris:      { name: 'QRIS',     flag: '🇮🇩', currency: 'IDR' },
  qrph:      { name: 'QR Ph',    flag: '🇵🇭', currency: 'PHP' },
  duitnow:   { name: 'DuitNow',  flag: '🇲🇾', currency: 'MYR' },
};

export default function UnifiedSendScreen() {
  const nav = useNavigate();

  const [input, setInput]         = useState('');
  const [cameraOpen, setCameraOpen] = useState(false);
  const [detectResult, setDetectResult] = useState(null);  // { rail, confidence, parsed, disambiguation? }
  const [amountLocal, setAmountLocal]   = useState('');
  const [selectedRail, setSelectedRail] = useState(null);
  const [card, setCard]           = useState(null);
  const [fxSpot, setFxSpot]       = useState(null);   // { rate, source, currency }
  const [warmTokenId, setWarmTokenId] = useState(null);
  const [paying, setPaying]       = useState(false);
  const [err, setErr]             = useState(null);
  const [camErr, setCamErr]       = useState(null);
  const [policy, setPolicy]       = useState(null);  // { tier, minimum_fee_aud, local_round_unit, ... }

  const debounceRef  = useRef(null);
  const videoRef     = useRef(null);
  const canvasRef    = useRef(null);
  const rafRef       = useRef(0);
  const streamRef    = useRef(null);
  const decodedRef   = useRef(false);

  // Fetch default card on mount
  useEffect(() => {
    let cancelled = false;
    fetchCards()
      .then(({ cards }) => {
        if (cancelled) return;
        if (!cards || cards.length === 0) { nav('/link-card', { replace: true }); return; }
        setCard(cards.find(c => c.is_default) || cards[0]);
      })
      .catch(e => { if (!cancelled) setErr(e.message); });
    return () => { cancelled = true; };
  }, [nav]);

  // Fetch commission policy on mount: drives the localized-minimum hint.
  useEffect(() => {
    let cancelled = false;
    fetchPolicy()
      .then(p => { if (!cancelled) setPolicy(p); })
      .catch(() => {});  // Hint is optional; silently degrade.
    return () => { cancelled = true; };
  }, []);

  // Debounced detect call on input change
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const trimmed = input.trim();
    if (!trimmed) { setDetectResult(null); setSelectedRail(null); return; }

    debounceRef.current = setTimeout(async () => {
      try {
        const res = await detect({ input: trimmed });
        setDetectResult(res);
        if (res.matched) {
          setSelectedRail(res.rail);
          const currency = RAIL_LABELS[res.rail]?.currency || 'VND';
          // Fetch live rate in parallel; don't block render
          getFxRate(currency).then(r => setFxSpot(r)).catch(() => {});
          // Pre-warm card for ATM QR immediately; fires in background.
          if (res.parsed?.qrType === 'atm' && card) {
            const pmId = card.stripe_pm_id || card.id;
            warmCard({ paymentMethodId: pmId })
              .then(w => setWarmTokenId(w.warmTokenId))
              .catch(() => {});
          }
        } else {
          setSelectedRail(null);
          setFxSpot(null);
        }
        setErr(null);
      } catch (e) {
        setDetectResult(null);
        setErr(e.message);
      }
    }, 300);

    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [input]);

  // Camera: start/stop
  useEffect(() => {
    if (!cameraOpen) {
      stopStream();
      return;
    }
    let cancelled = false;
    decodedRef.current = false;
    setCamErr(null);

    async function startCamera() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: false,
        });
        if (cancelled) { stopStreamObj(stream); return; }
        streamRef.current = stream;
        const video = videoRef.current;
        if (!video) { stopStreamObj(stream); return; }
        video.srcObject = stream;
        video.playsInline = true;
        video.muted = true;
        await video.play();
        tick();
      } catch (e) {
        if (cancelled) return;
        setCamErr(
          e.name === 'NotAllowedError' ? 'Camera permission denied.' :
          e.name === 'NotFoundError'   ? 'No camera found.' : e.message
        );
        setCameraOpen(false);
      }
    }

    function tick() {
      if (cancelled) return;
      const video  = videoRef.current;
      const canvas = canvasRef.current;
      if (!video || !canvas || video.readyState !== video.HAVE_ENOUGH_DATA) {
        rafRef.current = requestAnimationFrame(tick);
        return;
      }
      const w = video.videoWidth, h = video.videoHeight;
      canvas.width = w; canvas.height = h;
      const ctx  = canvas.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(video, 0, 0, w, h);
      const img  = ctx.getImageData(0, 0, w, h);
      const code = jsQR(img.data, w, h, { inversionAttempts: 'dontInvert' });
      if (code && code.data && !decodedRef.current) {
        decodedRef.current = true;
        setInput(code.data);
        setCameraOpen(false);
        return;
      }
      rafRef.current = requestAnimationFrame(tick);
    }

    startCamera();
    return () => {
      cancelled = true;
      cancelAnimationFrame(rafRef.current);
      stopStream();
    };
  }, [cameraOpen]);

  function stopStream() {
    if (streamRef.current) stopStreamObj(streamRef.current);
    streamRef.current = null;
  }
  function stopStreamObj(s) {
    try { s.getTracks().forEach(t => t.stop()); } catch (_) {}
  }

  const rail = selectedRail || detectResult?.rail;
  const railMeta = rail ? RAIL_LABELS[rail] : null;
  const amtValid = parseFloat(amountLocal) > 0;
  const canPay   = !!rail && amtValid && !!card && !paying;

  usePayNav({
    back: { label: 'Home', onClick: () => nav('/welcome') },
    next: canPay
      ? { label: paying ? 'Sending…' : `Pay ${railMeta?.currency || ''} ${amountLocal}`.trim(), onClick: () => onPay(), loading: paying, variant: 'primary' }
      : { label: 'Pay', variant: 'primary' },
  }, [canPay, paying, railMeta?.currency, amountLocal]);

  // Localized minimum hint: e.g. "3,500 VND minimum" for a Free user paying in VND.
  // Only shown when the tier has a non-zero AUD minimum AND we have a live rail FX rate.
  const localizedMin = (() => {
    if (!policy || !policy.minimum_fee_aud) return null;
    if (!fxSpot || !fxSpot.rate || fxSpot.rate <= 0) return null;
    if (!railMeta || !railMeta.currency) return null;
    const unit = (policy.local_round_unit && policy.local_round_unit[railMeta.currency]) || 1;
    return Math.ceil((policy.minimum_fee_aud * fxSpot.rate) / unit) * unit;
  })();

  async function onPay() {
    if (!canPay) return;
    setPaying(true);
    setErr(null);

    const isATM     = detectResult?.parsed?.qrType === 'atm';
    const pmId      = card.stripe_pm_id || card.id;
    const spotRate  = fxSpot?.rate || null;

    try {
      let result;
      if (isATM) {
        // Get GPS for ATM geo-verification (best-effort; 5s max)
        let lat, lng;
        try {
          const pos = await new Promise((resolve, reject) => {
            navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 5000 });
          });
          lat = pos.coords.latitude;
          lng = pos.coords.longitude;
        } catch (_) {}

        if (!warmTokenId) throw new Error('Card pre-auth not ready. Please wait a moment and retry.');
        if (!spotRate)    throw new Error('Exchange rate not loaded. Please wait and retry.');

        result = await initiateATMPayment({
          qr:              input.trim(),
          amount:          parseFloat(amountLocal),
          currency:        railMeta?.currency,
          paymentMethodId: pmId,
          warmTokenId,
          fxSpot:          spotRate,
          lat, lng,
        });
      } else {
        result = await initiatePayment({
          input:           input.trim(),
          rail,
          amountLocal:     parseFloat(amountLocal),
          currency:        railMeta?.currency,
          paymentMethodId: pmId,
          ...(spotRate ? { fxSpot: spotRate } : {}),
        });
      }

      if (!result.paymentId) throw new Error('No paymentId returned');
      nav('/confirming', { state: { paymentId: result.paymentId, rail, railMeta, amountLocal, card } });
    } catch (e) {
      setErr(
        e.status === 402 ? 'Card declined. Try another card.' :
        e.status === 422 ? 'QR not routable. Check the code and try again.' :
        e.message
      );
      setPaying(false);
    }
  }

  return (
    <div className="kp-fullscreen kp-send-root">
      <div className="kp-header">
        <div className="kp-send-title">Send</div>
        {card && (
          <div className="kp-card-chip">
            {card.card_brand || card.brand || 'Card'} ···· {card.card_last4 || card.last4}
          </div>
        )}
      </div>

      {/* Input row */}
      <div className="kp-send-input-row">
        <input
          className="kp-send-input"
          type="text"
          placeholder="Paste QR data or identifier…"
          value={input}
          onChange={e => setInput(e.target.value)}
          autoComplete="off"
          spellCheck={false}
        />
        <button
          className="kp-icon-btn kp-scan-btn"
          onClick={() => setCameraOpen(o => !o)}
          aria-label={cameraOpen ? 'Close camera' : 'Scan QR'}
        >
          {cameraOpen ? '✕' : '⊡'}
        </button>
      </div>

      {/* Camera */}
      {cameraOpen && (
        <div className="kp-camera-container">
          <video ref={videoRef} className="kp-scan-video" />
          <canvas ref={canvasRef} style={{ display: 'none' }} />
          <div className="kp-scan-reticle">
            <div className="kp-scan-reticle-inner">
              <span className="kp-corner kp-tl" /><span className="kp-corner kp-tr" />
              <span className="kp-corner kp-bl" /><span className="kp-corner kp-br" />
            </div>
          </div>
          {camErr && <div className="kp-cam-err">{camErr}</div>}
        </div>
      )}

      {/* Rail detection result */}
      {detectResult && !cameraOpen && (
        <div className="kp-rail-result">
          {detectResult.matched && railMeta && (
            <div className="kp-rail-badge">
              <span>{railMeta.flag}</span>
              <span className="kp-rail-name">{railMeta.name}</span>
              <span className="kp-conf">{(detectResult.confidence * 100).toFixed(0)}%</span>
            </div>
          )}
          {detectResult.ambiguous && (
            <div className="kp-disambiguation">
              <div className="kp-dim kp-xs">Multiple rails detected. Select one:</div>
              {detectResult.candidates.map(c => (
                <button
                  key={c.rail}
                  className={`kp-rail-pick ${selectedRail === c.rail ? 'kp-rail-pick--selected' : ''}`}
                  onClick={() => setSelectedRail(c.rail)}
                >
                  {RAIL_LABELS[c.rail]?.flag} {RAIL_LABELS[c.rail]?.name || c.rail}
                  <span className="kp-conf">{(c.confidence * 100).toFixed(0)}%</span>
                </button>
              ))}
            </div>
          )}
          {!detectResult.matched && !detectResult.ambiguous && (
            <div className="kp-dim kp-xs">No payment rail detected. Try scanning a QR code.</div>
          )}
        </div>
      )}

      {/* Amount entry */}
      {rail && (
        <div className="kp-amount-section">
          <div className="kp-amount-label">
            Amount in {railMeta?.currency || 'local currency'}
          </div>
          <div className="kp-amount-row">
            <span className="kp-currency-tag">{railMeta?.currency}</span>
            <input
              className="kp-amount-input"
              type="number"
              inputMode="decimal"
              placeholder="0"
              value={amountLocal}
              onChange={e => setAmountLocal(e.target.value)}
              min="0"
            />
          </div>
          {amtValid && (
            <div className="kp-aud-hint kp-dim kp-xs">
              ≈ AUD {fxSpot?.rate
                ? (parseFloat(amountLocal) / fxSpot.rate).toFixed(2)
                : '…'}
              {fxSpot?.source === 'facilitator'
                ? <span className="kp-live"> (live)</span>
                : <span className="kp-indicative"> (indicative)</span>}
            </div>
          )}
          {localizedMin != null && (
            <div className="kp-min-hint kp-dim kp-xs">
              {localizedMin.toLocaleString('en-US')} {railMeta.currency} minimum
            </div>
          )}
        </div>
      )}

      {err && <div className="kp-err kp-pad">{err}</div>}

      {/* Pay action lives in the persistent PayNav dock. */}
    </div>
  );
}
