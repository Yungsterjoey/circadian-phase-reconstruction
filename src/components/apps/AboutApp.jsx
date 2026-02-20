/**
 * KURO :: ABOUT APP v1.0
 * Tabbed: ABOUT · FEATURES · PRICING · LEGAL
 * Houses all marketing content + full legal documents post-login.
 * KURO/Sony PS1 UX aesthetic — dark, monochrome base, purple accent.
 */
import { useState } from 'react';

/* ─── 3D Cube (matches AuthGate cube) ──────────────────────────────── */
const GlassCube = ({ size = 64 }) => (
  <div style={{ width: size, height: size, perspective: 800, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
    <div style={{ width: size, height: size, position: 'relative', transformStyle: 'preserve-3d', animation: 'abtCubeRot 20s linear infinite' }}>
      {['ft','bk','rt','lt','tp','bt'].map(f => (
        <div key={f} className={`abt-cf ${f}`} style={{ width: size, height: size, '--h': `${size/2}px` }} />
      ))}
    </div>
  </div>
);

/* ─── Data ──────────────────────────────────────────────────────────── */
const TABS = ['ABOUT', 'FEATURES', 'PRICING', 'LEGAL'];

const FEATURES = [
  { icon: '⚡', color: '#a855f7', title: '12-Layer Cognitive Pipeline', desc: 'Iron Dome threat detection, IFF gate, Edubba knowledge retrieval, semantic routing, memory engine, orchestrator, fire control, reasoning, Maat refiner, enhancer, streaming, feedback — every message.' },
  { icon: '🖥', color: '#3b82f6',  title: 'Full Desktop Environment',   desc: 'Windowed OS in your browser. Draggable windows, glass dock, app launcher, file explorer, terminal, browser. Not a chat window — a workspace.' },
  { icon: '🤖', color: '#22c55e',  title: 'Specialised AI Agents',       desc: 'Insights for analysis, Actions for execution, Analysis for research — each with scoped permissions and signed audit trails.' },
  { icon: '🔐', color: '#f59e0b',  title: 'Ed25519 Audit Chain',         desc: 'Every interaction cryptographically signed. Tamper-evident logs for compliance. Provable, verifiable interaction history.' },
  { icon: '🎨', color: '#ef4444',  title: 'KURO::VISION Image Gen',      desc: 'Intent detection, quality evaluation, and local GPU inference — no external API calls. Generated on dedicated hardware.' },
  { icon: '📚', color: '#06b6d4',  title: 'Private Knowledge Engine',    desc: 'Upload documents, build a private knowledge base, query it in conversation. Vector embeddings stored locally on inference servers.' },
];

const PIPELINE = [
  { name: 'Iron Dome',       color: '#ef4444' },
  { name: 'IFF Gate',        color: '#f97316' },
  { name: 'Edubba Archive',  color: '#eab308' },
  { name: 'Semantic Router', color: '#22c55e' },
  { name: 'Memory Engine',   color: '#14b8a6' },
  { name: 'Orchestrator',    color: '#06b6d4' },
  { name: 'Fire Control',    color: '#3b82f6' },
  { name: 'Reasoning',       color: '#6366f1' },
  { name: 'Maat Refiner',    color: '#8b5cf6' },
  { name: 'Enhancer',        color: '#a855f7' },
  { name: 'Stream',          color: '#d946ef' },
  { name: 'Feedback',        color: '#ec4899' },
];

const TIERS = [
  {
    label: 'FREE', price: '$0', period: '', quota: '25 messages + 1 image / week',
    features: ['25 AI chat messages / week', '1 image generation / week', '12-layer pipeline active', 'Thinking + reasoning visible', 'Insights agent'],
    stripe: null, featured: false,
  },
  {
    label: 'PRO', price: '$19', period: '/mo', quota: '1,400 messages + 140 images / week',
    features: ['1,400 messages / week', '140 image generations / week', 'Insights + Actions agents', '12-layer pipeline active', 'Priority inference', 'Email support'],
    stripe: 'https://buy.stripe.com/cNi5kDepSaFPaCyeJd5sA00', featured: true,
  },
  {
    label: 'SOVEREIGN', price: '$49', period: '/mo', quota: '3,500 messages + 350 images / week',
    features: ['Everything in Pro', 'Full KURO OS desktop environment', 'All AI agents + creative model', 'DEV mode — code execution', 'Terminal + file explorer', 'Knowledge engine (RAG)', 'REST API access', 'Audit log export', 'Priority support'],
    stripe: 'https://buy.stripe.com/cNi8wPgy0bJTdOK44z5sA01', featured: false,
  },
];

const LEGAL_TABS = ['Terms', 'Privacy', 'Disclaimer', 'AUP', 'Cookies'];

const LEGAL_CONTENT = {
  Terms: {
    title: 'Terms of Service',
    date: 'Last updated: 14 February 2026 · Version 1.0',
    sections: [
      ['1. Operator', 'KURO OS is operated by Henry George Lowe trading as KURO Technologies, ABN 45 340 322 909, Melbourne, Victoria, Australia ("we", "us", "KURO").'],
      ['2. Acceptance', 'By accessing or using KURO OS, you agree to be bound by these Terms. If you do not agree, do not use the service. You must be at least 18 years of age to use KURO OS.'],
      ['3. Service Description', 'KURO OS is an AI-powered operating system providing conversational AI, code execution, image generation, and related tools. AI inference runs on dedicated GPU hardware located in the United States. The platform uses third-party services including Cloudflare (security and CDN) and Stripe (payment processing). "Sovereign" refers to our architecture where AI models run on dedicated hardware not shared with other providers\' training pipelines — it does not mean the platform operates without any third-party infrastructure services.'],
      ['4. Accounts & Access', 'Access is via token-based authentication. You are responsible for maintaining the confidentiality of your access tokens. Notify us immediately at hi@kuroglass.net if you believe your token has been compromised.'],
      ['5. Acceptable Use', 'You agree to comply with our Acceptable Use Policy. We reserve the right to suspend or terminate access for violations. See the AUP for prohibited activities and enforcement procedures.'],
      ['6. AI Output & Limitations', 'AI outputs are probabilistic and may contain errors, inaccuracies, or biases. Outputs do not constitute professional advice of any kind — including medical, legal, financial, engineering, or safety-critical advice. You are solely responsible for evaluating and acting on AI outputs. Code execution occurs in a sandboxed environment; however, you accept all risk associated with executing generated code.'],
      ['7. Data & Privacy', 'Your use of KURO OS is also governed by our Privacy Policy. Conversations processed through KURO OS are not used to train AI models. Conversation data is stored on the inference server in the United States and subject to the retention periods described in our Privacy Policy.'],
      ['8. Billing & Subscriptions', 'Paid plans are billed monthly via Stripe. Subscriptions renew automatically until cancelled. You may cancel at any time; cancellation takes effect at the end of the current billing period. No partial refunds are issued for the remaining days of a billing period after cancellation. Access tokens are delivered to your email address upon successful payment.'],
      ['9. Australian Consumer Law', 'Nothing in these Terms excludes, restricts, or modifies any consumer guarantee, right, or remedy conferred by the Australian Consumer Law (Schedule 2 of the Competition and Consumer Act 2010) or any other applicable law that cannot be excluded, restricted, or modified by agreement. If the Australian Consumer Law applies to you as a consumer, our liability for failure to comply with a consumer guarantee is limited (where permitted) to resupplying the service or paying the cost of having the service resupplied.'],
      ['10. Service Availability', 'We aim to provide reliable service but do not guarantee uninterrupted availability. We may suspend the service for maintenance, updates, security incidents, or circumstances beyond our control. We will make reasonable efforts to provide advance notice of planned maintenance.'],
      ['11. Limitation of Liability', 'To the maximum extent permitted by law and subject to clause 9 (Australian Consumer Law), our total aggregate liability for any claims arising from or related to the service is limited to the total fees you have paid to us in the 12 months preceding the claim. We are not liable for any indirect, incidental, special, consequential, or punitive damages.'],
      ['12. Disputes', 'If you have a dispute, please contact us at hi@kuroglass.net. We will attempt to resolve disputes informally within 30 days. If informal resolution is unsuccessful, disputes will be subject to the jurisdiction of the courts of Victoria, Australia, or the Victorian Civil and Administrative Tribunal (VCAT) where applicable.'],
      ['13. Changes', 'We may update these Terms from time to time. Material changes will be communicated via the email address associated with your account. Continued use after changes constitutes acceptance.'],
      ['14. Governing Law', 'These Terms are governed by the laws of Victoria, Australia.'],
      ['15. Contact', 'hi@kuroglass.net'],
    ]
  },
  Privacy: {
    title: 'Privacy Policy',
    date: 'Last updated: 14 February 2026 · Version 1.0',
    sections: [
      ['Data Controller', 'Henry George Lowe trading as KURO Technologies, ABN 45 340 322 909, Melbourne, Victoria, Australia. Contact: hi@kuroglass.net'],
      ['What We Collect & Why', 'Access tokens (authentication/session management), email address (token delivery and service communications — not marketing), conversation data (AI model processing on dedicated GPU infrastructure), payment metadata via Stripe (we do not store card numbers, CVVs, or bank details), IP addresses and request metadata via Cloudflare (security monitoring), anonymised usage metrics (service health and capacity — not linked to individuals).'],
      ['What We Do Not Do', 'We do not sell, rent, or trade your personal information. We do not use your conversations to train AI models. We do not use advertising or tracking cookies. We do not share data with advertisers or data brokers.'],
      ['Where Data Is Stored', 'AI inference, conversation data, and session files on dedicated GPU servers in the United States (TensorDock infrastructure). Authentication configuration on the same servers. Payments via Stripe (global). Security and CDN via Cloudflare (global). By using KURO OS, you consent to this overseas transfer and processing.'],
      ['Third-Party Processors', 'Cloudflare: CDN, DDoS protection, SSL termination (cloudflare.com/privacypolicy). Stripe: payment processing, subscription management (stripe.com/privacy). Brevo (Sendinblue): transactional email delivery — access tokens and OTP codes (brevo.com/legal/privacypolicy).'],
      ['Data Retention', 'Conversation sessions: 90 days (lab profile), then automatically purged. Audit logs: 90 days (lab profile); government deployment profiles: up to 7 years. Account & billing records: duration of subscription plus 7 years (Australian Taxation Office requirements). Access tokens: active until revoked or subscription cancelled.'],
      ['Security', 'TLS 1.3 encryption in transit (Cloudflare). Cryptographically generated authentication tokens. Ed25519 signed audit logs for tamper detection. SSH key-restricted server access. AI models on isolated GPU infrastructure not shared with other tenants.'],
      ['Your Rights', 'Under the Australian Privacy Act 1988: access your personal information, request correction of inaccurate information, request deletion (subject to legal retention requirements). Email hi@kuroglass.net. We will respond within 30 days. Data available in machine-readable format on request.'],
      ['Complaints', 'If you believe we have breached the Australian Privacy Principles, contact us at hi@kuroglass.net. We will investigate and respond within 30 days. You may also lodge a complaint with the Office of the Australian Information Commissioner (OAIC) at oaic.gov.au or 1300 363 992.'],
      ['Changes', 'Material changes communicated via the email address associated with your account. The "Last updated" date indicates the most recent revision.'],
    ]
  },
  Disclaimer: {
    title: 'Disclaimer',
    date: '',
    sections: [
      ['AI Output', 'All AI-generated content is probabilistic and may contain errors, inaccuracies, hallucinations, or biases. Outputs should not be relied upon without independent verification.'],
      ['Not Professional Advice', 'KURO OS does not provide and AI outputs do not constitute: medical or health advice; legal advice; financial, investment, or tax advice; engineering or safety-critical guidance; or any other form of professional advice. Always consult qualified professionals for decisions in these areas.'],
      ['Code Execution', 'The DEV mode code execution environment is sandboxed, but you use it entirely at your own risk. We are not responsible for any data loss, system damage, or other consequences of executing AI-generated code, whether in the sandbox or copied to your own systems.'],
      ['Image Generation', 'AI-generated images may not accurately represent reality. You are responsible for ensuring any generated images comply with applicable laws and do not infringe on the rights of others.'],
      ['Service Accuracy', 'While we strive for reliability, we do not guarantee that the service will be error-free, uninterrupted, or meet your specific requirements. Use the service at your own discretion and risk.'],
    ]
  },
  AUP: {
    title: 'Acceptable Use Policy',
    date: 'Last updated: 14 February 2026',
    sections: [
      ['Prohibited Activities', 'You may not use KURO OS to: generate, store, or distribute child sexual abuse material (CSAM); create content promoting violence, terrorism, or extremism; develop malware, phishing tools, or exploit code; harass, threaten, or stalk individuals; generate non-consensual intimate imagery or deepfakes of real people; circumvent security controls or access restrictions; perform automated scraping or denial-of-service attacks; resell or redistribute access tokens; produce content that violates Australian law or the law of your jurisdiction.'],
      ['Enforcement — Minor', 'Accidental misuse, borderline content: Written warning via email. Repeated minor violations may escalate.'],
      ['Enforcement — Serious', 'Harassment, malware generation, circumvention: Immediate temporary suspension pending review. We will notify you within 48 hours with details and an opportunity to respond.'],
      ['Enforcement — Severe', 'CSAM, terrorism, illegal content: Immediate permanent termination without prior notice. We may report to relevant law enforcement authorities as required by law.'],
      ['Appeals', 'If your access has been suspended or terminated for a serious violation, you may appeal by emailing hi@kuroglass.net within 14 days of notification. Appeals reviewed within 14 business days. Severe violations (CSAM, terrorism) are not eligible for appeal.'],
      ['Reporting', 'To report abuse or policy violations by another user, contact hi@kuroglass.net with relevant details. We will acknowledge receipt within 48 hours and investigate promptly.'],
      ['Monitoring', 'We maintain automated threat detection systems (Iron Dome) that filter harmful inputs. Audit logs record interactions for security purposes. We do not proactively monitor conversation content, but may review flagged sessions during investigations.'],
    ]
  },
  Cookies: {
    title: 'Cookie Policy',
    date: 'Last updated: 14 February 2026',
    sections: [
      ['Overview', 'KURO OS uses a minimal set of cookies and browser storage technologies. We do not use advertising, tracking, or marketing cookies.'],
      ['Essential Cookies (always active)', '__cf_bm (Cloudflare, 30min): Bot detection/security. cf_clearance (Cloudflare, 30min): Security challenge clearance. __cfruid (Cloudflare, Session): Rate limiting. kuro_session (KURO OS, 24h): Authentication session.'],
      ['Local Storage (browser-side only)', 'kuro_token: Stores your access token for authentication. kuro_cookies: Records your cookie consent choice. kuro_demo_count: Tracks free demo message usage. kuro_demo_week: Weekly reset counter for demo messages.'],
      ['Third-Party Cookies (payment pages only)', '__stripe_mid (Stripe): Fraud prevention during checkout. __stripe_sid (Stripe): Checkout session management.'],
      ['Analytics', 'KURO OS does not currently use any third-party analytics services. If we add analytics in the future, we will update this policy and request your consent before loading any analytics scripts.'],
      ['Managing Cookies', 'Essential cookies cannot be disabled as they are required for the service to function. You can clear all browser cookies and local storage via your browser settings. Note that clearing local storage will log you out and reset your demo message counter.'],
      ['Your Consent', 'Your cookie consent preference is stored locally with a timestamp and version identifier. You can withdraw or change your consent at any time by clearing your browser\'s local storage.'],
    ]
  },
};

/* ═══════════════════════════════════════════════════════════════════════
   SECTIONS
   ═══════════════════════════════════════════════════════════════════════ */
function AboutSection() {
  return (
    <div className="abt-about">
      {/* Brand hero */}
      <div className="abt-brand-hero">
        <GlassCube size={72} />
        <div className="abt-brand-text">
          <div className="abt-kuro">KURO</div>
          <div className="abt-os">.OS</div>
          <div className="abt-tag">SOVEREIGN INTELLIGENCE PLATFORM</div>
        </div>
      </div>

      <p className="abt-lead">
        AI that runs on your hardware. A sovereign operating system with a 12-layer cognitive pipeline,
        running on dedicated GPU infrastructure. Your data never leaves the server.
      </p>

      {/* Compare */}
      <div className="abt-section-label">WHY SOVEREIGN</div>
      <div className="abt-compare">
        <div className="abt-cmp-card abt-cmp-them">
          <div className="abt-cmp-tag">CLOUD LLMs</div>
          {['Your data trains their models','Rate limits on your own thinking','Conversations stored on servers you don\'t control','One policy change breaks your workflow','No audit trail or proof of interaction'].map((t,i) => (
            <div key={i} className="abt-cmp-item"><span className="abt-cmp-x">✗</span>{t}</div>
          ))}
        </div>
        <div className="abt-cmp-card abt-cmp-us">
          <div className="abt-cmp-tag">KURO OS</div>
          {['AI inference runs on dedicated GPUs you don\'t share','No rate limits — your own hardware allocation','Cryptographically signed audit trails','Conversations never used for training','Government-grade deployment profiles'].map((t,i) => (
            <div key={i} className="abt-cmp-item"><span className="abt-cmp-check">✓</span>{t}</div>
          ))}
        </div>
      </div>

      {/* Pipeline */}
      <div className="abt-section-label" style={{ marginTop: 24 }}>12-LAYER PIPELINE</div>
      <p className="abt-sublead">Defence-in-depth cognitive processing — every message, every time.</p>
      <div className="abt-pipeline">
        {PIPELINE.map((layer, i) => (
          <div key={i} className="abt-pipe-node">
            <div className="abt-pipe-dot" style={{ background: layer.color }} />
            <span>{layer.name}</span>
          </div>
        ))}
      </div>

      {/* Footer */}
      <div className="abt-company">
        <div className="abt-company-name">KURO OS</div>
        <div className="abt-company-entity">Henry George Lowe trading as KURO Technologies</div>
        <div className="abt-company-entity">ABN 45 340 322 909 · Melbourne, Victoria, Australia</div>
        <div className="abt-company-desc">
          Sovereign AI infrastructure. Built in Melbourne, running on dedicated GPU hardware in the United States.
          Enterprise with dedicated nodes from $499/mo — <a href="mailto:hi@kuroglass.net">hi@kuroglass.net</a>
        </div>
      </div>
    </div>
  );
}

function FeaturesSection() {
  return (
    <div className="abt-features">
      <div className="abt-section-label">CAPABILITIES</div>
      <h2 className="abt-section-h2">Not a chatbot. An <em>operating system.</em></h2>
      <p className="abt-section-lead">Desktop environment, AI agents, and sovereign infrastructure in one platform.</p>
      <div className="abt-feat-grid">
        {FEATURES.map((f, i) => (
          <div key={i} className="abt-feat-card">
            <div className="abt-feat-icon" style={{ background: `${f.color}18`, color: f.color }}>{f.icon}</div>
            <h3>{f.title}</h3>
            <p>{f.desc}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function PricingSection() {
  return (
    <div className="abt-pricing">
      <div className="abt-section-label">PRICING</div>
      <h2 className="abt-section-h2">Sovereign intelligence. <em>Your terms.</em></h2>
      <p className="abt-section-lead">Try it free. Upgrade when you're ready.</p>
      <div className="abt-price-grid">
        {TIERS.map((t, i) => (
          <div key={i} className={`abt-price-card${t.featured ? ' abt-price-featured' : ''}`}>
            {t.featured && <div className="abt-price-badge">MOST POPULAR</div>}
            <div className="abt-price-tier">{t.label}</div>
            <div className="abt-price-amount">{t.price}<span>{t.period}</span></div>
            <div className="abt-price-quota">{t.quota}</div>
            <ul className="abt-price-list">
              {t.features.map((f, j) => <li key={j}><span>✓</span>{f}</li>)}
            </ul>
            {t.stripe ? (
              <a className="abt-price-btn abt-price-btn-primary" href={t.stripe} target="_blank" rel="noopener">
                Subscribe to {t.label}
              </a>
            ) : (
              <div className="abt-price-btn abt-price-btn-free">Current Plan (Free)</div>
            )}
          </div>
        ))}
      </div>
      <p className="abt-price-note">
        All subscriptions can be cancelled anytime. Enterprise with dedicated nodes from $499/mo —{' '}
        <a href="mailto:hi@kuroglass.net">hi@kuroglass.net</a>
      </p>
    </div>
  );
}

function LegalSection() {
  const [activeDoc, setActiveDoc] = useState('Terms');
  const doc = LEGAL_CONTENT[activeDoc];
  return (
    <div className="abt-legal">
      {/* Legal sub-tabs */}
      <div className="abt-legal-tabs">
        {LEGAL_TABS.map(t => (
          <button key={t} className={`abt-legal-tab${activeDoc === t ? ' active' : ''}`} onClick={() => setActiveDoc(t)}>{t}</button>
        ))}
      </div>
      <div className="abt-legal-body">
        <h2 className="abt-legal-title">{doc.title}</h2>
        {doc.date && <p className="abt-legal-date">{doc.date}</p>}
        {doc.sections.map(([heading, text], i) => (
          <div key={i} className="abt-legal-section">
            <strong>{heading}.</strong> {text}
          </div>
        ))}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
   ROOT COMPONENT
   ═══════════════════════════════════════════════════════════════════════ */
export default function AboutApp() {
  const [activeTab, setActiveTab] = useState('ABOUT');

  return (
    <div className="abt-root">
      {/* Styles */}
      <style>{`
/* ─── Root ─────────────────────────────────────────────────────────── */
.abt-root {
  display: flex; flex-direction: column; height: 100%; overflow: hidden;
  font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Display', sans-serif;
  color: rgba(255,255,255,0.85);
}
.abt-root *, .abt-root *::before, .abt-root *::after { box-sizing: border-box; }

/* ─── Cube ─────────────────────────────────────────────────────────── */
@keyframes abtCubeRot { from { transform: rotateX(-20deg) rotateY(-30deg); } to { transform: rotateX(-20deg) rotateY(330deg); } }
.abt-cf {
  position: absolute;
  background: linear-gradient(135deg, rgba(91,33,182,0.35), rgba(76,29,149,0.25) 50%, rgba(49,10,101,0.45));
  border: 1px solid rgba(139,92,246,0.25); backdrop-filter: blur(4px); -webkit-backdrop-filter: blur(4px);
}
.abt-cf.ft { transform: translateZ(var(--h)); }
.abt-cf.bk { transform: rotateY(180deg) translateZ(var(--h)); }
.abt-cf.rt { transform: rotateY(90deg) translateZ(var(--h)); }
.abt-cf.lt { transform: rotateY(-90deg) translateZ(var(--h)); }
.abt-cf.tp { transform: rotateX(90deg) translateZ(var(--h)); }
.abt-cf.bt { transform: rotateX(-90deg) translateZ(var(--h)); }
@media (prefers-reduced-motion: reduce) { [style*="abtCubeRot"] { animation: none; transform: rotateX(-20deg) rotateY(-30deg); } }

/* ─── Main tabs ────────────────────────────────────────────────────── */
.abt-tabs {
  display: flex; gap: 0; border-bottom: 1px solid rgba(255,255,255,0.06);
  background: rgba(0,0,0,0.2); flex-shrink: 0;
}
.abt-tab {
  padding: 10px 18px; background: none; border: none; border-bottom: 2px solid transparent;
  color: rgba(255,255,255,0.35); font-size: 10px; font-weight: 700; letter-spacing: 2px;
  cursor: pointer; transition: all 0.15s; font-family: inherit;
  margin-bottom: -1px;
}
.abt-tab:hover { color: rgba(255,255,255,0.6); }
.abt-tab.active { color: rgba(255,255,255,0.9); border-bottom-color: #a855f7; }

/* ─── Scrollable content area ─────────────────────────────────────── */
.abt-content { flex: 1; overflow-y: auto; padding: 24px; }

/* ─── Shared section typography ───────────────────────────────────── */
.abt-section-label {
  font-size: 9px; font-weight: 700; letter-spacing: 3px; color: rgba(255,255,255,0.3);
  text-transform: uppercase; margin-bottom: 8px;
}
.abt-section-h2 { font-size: 22px; font-weight: 200; color: rgba(255,255,255,0.9); margin: 0 0 6px; }
.abt-section-h2 em { font-style: normal; font-weight: 600; color: #fff; }
.abt-section-lead { font-size: 13px; color: rgba(255,255,255,0.45); margin: 0 0 20px; line-height: 1.5; }
.abt-sublead { font-size: 12px; color: rgba(255,255,255,0.4); margin: 0 0 12px; }

/* ─── ABOUT section ─────────────────────────────────────────────────── */
.abt-about { display: flex; flex-direction: column; gap: 4px; }

.abt-brand-hero { display: flex; align-items: center; gap: 20px; margin-bottom: 14px; }
.abt-brand-text { display: flex; flex-direction: column; }
.abt-kuro { font-size: 42px; font-weight: 200; letter-spacing: 12px; color: rgba(255,255,255,0.95); line-height: 1; }
.abt-os { font-size: 22px; font-weight: 500; letter-spacing: 7px; color: #a855f7; line-height: 1.2; }
.abt-tag { font-size: 9px; font-weight: 500; letter-spacing: 3.5px; color: rgba(255,255,255,0.28); margin-top: 6px; }
.abt-lead { font-size: 14px; color: rgba(255,255,255,0.5); line-height: 1.7; margin-bottom: 20px; }

.abt-compare { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.abt-cmp-card { padding: 14px; border-radius: var(--lg-radius-md,16px); border: 1px solid rgba(255,255,255,0.06); background: rgba(255,255,255,0.02); }
.abt-cmp-them { border-color: rgba(239,68,68,0.12); }
.abt-cmp-us   { border-color: rgba(147,51,234,0.18); background: rgba(147,51,234,0.03); }
.abt-cmp-tag { font-size: 9px; font-weight: 700; letter-spacing: 2px; color: rgba(255,255,255,0.3); margin-bottom: 8px; }
.abt-cmp-them .abt-cmp-tag { color: rgba(239,68,68,0.6); }
.abt-cmp-us .abt-cmp-tag { color: rgba(168,85,247,0.7); }
.abt-cmp-item { display: flex; gap: 6px; font-size: 11px; color: rgba(255,255,255,0.5); padding: 4px 0; border-bottom: 1px solid rgba(255,255,255,0.04); line-height: 1.4; }
.abt-cmp-us .abt-cmp-item { color: rgba(255,255,255,0.7); }
.abt-cmp-x { color: rgba(239,68,68,0.6); flex-shrink: 0; }
.abt-cmp-check { color: #22c55e; flex-shrink: 0; }

.abt-pipeline { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 4px; }
.abt-pipe-node { display: flex; align-items: center; gap: 5px; padding: 4px 10px 4px 6px; background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.06); border-radius: 20px; }
.abt-pipe-dot { width: 6px; height: 6px; border-radius: 50%; flex-shrink: 0; }
.abt-pipe-node span { font-size: 10px; color: rgba(255,255,255,0.6); white-space: nowrap; }

.abt-company { margin-top: 24px; padding-top: 16px; border-top: 1px solid rgba(255,255,255,0.06); }
.abt-company-name { font-size: 13px; font-weight: 600; color: rgba(255,255,255,0.85); margin-bottom: 3px; }
.abt-company-entity { font-size: 11px; color: rgba(255,255,255,0.35); }
.abt-company-desc { font-size: 11px; color: rgba(255,255,255,0.4); margin-top: 8px; line-height: 1.6; }
.abt-company a { color: rgba(168,85,247,0.7); text-decoration: none; }
.abt-company a:hover { color: #a855f7; text-decoration: underline; }

/* ─── FEATURES section ─────────────────────────────────────────────── */
.abt-features { display: flex; flex-direction: column; }
.abt-feat-grid { display: grid; grid-template-columns: repeat(2,1fr); gap: 10px; }
@media (max-width: 500px) { .abt-feat-grid { grid-template-columns: 1fr; } }
.abt-feat-card { padding: 16px; border-radius: var(--lg-radius-md,16px); background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.06); }
.abt-feat-icon { width: 32px; height: 32px; border-radius: 9px; display: flex; align-items: center; justify-content: center; font-size: 16px; margin-bottom: 10px; }
.abt-feat-card h3 { font-size: 13px; font-weight: 600; color: rgba(255,255,255,0.85); margin: 0 0 5px; }
.abt-feat-card p { font-size: 11px; color: rgba(255,255,255,0.4); line-height: 1.6; margin: 0; }

/* ─── PRICING section ─────────────────────────────────────────────── */
.abt-pricing { display: flex; flex-direction: column; }
.abt-price-grid { display: grid; grid-template-columns: repeat(3,1fr); gap: 10px; }
@media (max-width: 520px) { .abt-price-grid { grid-template-columns: 1fr; max-width: 300px; } }
.abt-price-card {
  padding: 18px 14px; border-radius: var(--lg-radius-md,16px);
  background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.06);
  display: flex; flex-direction: column; align-items: center; position: relative;
}
.abt-price-featured { border-color: rgba(147,51,234,0.28); background: rgba(147,51,234,0.05); box-shadow: 0 0 32px -12px rgba(147,51,234,0.25); }
.abt-price-badge {
  position: absolute; top: -9px; left: 50%; transform: translateX(-50%);
  font-size: 8px; font-weight: 700; letter-spacing: 1.5px;
  background: linear-gradient(135deg,#9333ea,#6366f1); color: #fff;
  padding: 2px 10px; border-radius: 4px; white-space: nowrap;
}
.abt-price-tier { font-size: 10px; font-weight: 700; letter-spacing: 2px; color: rgba(255,255,255,0.4); margin-bottom: 4px; }
.abt-price-featured .abt-price-tier { color: #a855f7; }
.abt-price-amount { font-size: 30px; font-weight: 200; color: rgba(255,255,255,0.9); }
.abt-price-amount span { font-size: 13px; font-weight: 400; color: rgba(255,255,255,0.35); }
.abt-price-quota { font-size: 10px; color: rgba(255,255,255,0.3); text-align: center; margin: 4px 0 12px; line-height: 1.4; }
.abt-price-list { list-style: none; padding: 0; margin: 0 0 14px; width: 100%; text-align: left; flex: 1; }
.abt-price-list li { font-size: 11px; color: rgba(255,255,255,0.55); padding: 3px 0; display: flex; gap: 5px; }
.abt-price-list li span { color: #22c55e; flex-shrink: 0; }
.abt-price-btn {
  width: 100%; padding: 9px 12px; border-radius: var(--lg-radius-xs,8px); border: none;
  font-size: 12px; font-weight: 600; cursor: pointer; text-align: center;
  text-decoration: none; display: block; transition: opacity 0.2s; font-family: inherit;
}
.abt-price-btn-primary { background: linear-gradient(135deg,#9333ea,#6366f1); color: #fff; }
.abt-price-btn-primary:hover { opacity: 0.9; }
.abt-price-btn-free { background: rgba(255,255,255,0.05); color: rgba(255,255,255,0.4); cursor: default; }
.abt-price-note { margin-top: 14px; font-size: 11px; color: rgba(255,255,255,0.25); text-align: center; line-height: 1.5; }
.abt-price-note a { color: rgba(147,51,234,0.55); text-decoration: none; }
.abt-price-note a:hover { color: #a855f7; text-decoration: underline; }

/* ─── LEGAL section ─────────────────────────────────────────────────── */
.abt-legal { display: flex; flex-direction: column; height: 100%; }
.abt-legal-tabs {
  display: flex; gap: 4px; padding: 0 0 12px; flex-wrap: wrap; flex-shrink: 0;
  border-bottom: 1px solid rgba(255,255,255,0.06); margin-bottom: 16px;
}
.abt-legal-tab {
  padding: 6px 14px; background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.06);
  border-radius: var(--lg-radius-xs,8px); color: rgba(255,255,255,0.4);
  font-size: 11px; font-weight: 600; cursor: pointer; transition: all 0.15s; font-family: inherit;
}
.abt-legal-tab:hover { background: rgba(255,255,255,0.06); color: rgba(255,255,255,0.65); }
.abt-legal-tab.active { background: rgba(147,51,234,0.12); border-color: rgba(147,51,234,0.25); color: #c084fc; }
.abt-legal-body { flex: 1; }
.abt-legal-title { font-size: 18px; font-weight: 500; color: rgba(255,255,255,0.9); margin: 0 0 4px; }
.abt-legal-date { font-size: 11px; color: rgba(255,255,255,0.28); margin: 0 0 14px; }
.abt-legal-section {
  padding: 8px 0; border-bottom: 1px solid rgba(255,255,255,0.05);
  font-size: 12px; color: rgba(255,255,255,0.55); line-height: 1.7;
}
.abt-legal-section strong { color: rgba(255,255,255,0.85); }
      `}</style>

      {/* Main tabs */}
      <div className="abt-tabs">
        {TABS.map(t => (
          <button key={t} className={`abt-tab${activeTab === t ? ' active' : ''}`} onClick={() => setActiveTab(t)}>
            {t}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="abt-content">
        {activeTab === 'ABOUT'    && <AboutSection />}
        {activeTab === 'FEATURES' && <FeaturesSection />}
        {activeTab === 'PRICING'  && <PricingSection />}
        {activeTab === 'LEGAL'    && <LegalSection />}
      </div>
    </div>
  );
}
