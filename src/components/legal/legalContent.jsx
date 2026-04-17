/**
 * Legal content — ported verbatim from legacy landing.html.
 * Rendered inside <LegalModal />. Update copy here, not in markup files.
 */
import React from 'react';

const Clause = ({ title, children }) => (
  <p><strong>{title}</strong>{children}</p>
);
const Sub = ({ label, children }) => (
  <p className="lgl-indent"><em>{label}:</em> {children}</p>
);

const MAIL_TOKEN = 'legal@kuroglass.net';
const Mail = () => <a href={`mailto:${MAIL_TOKEN}`}>{MAIL_TOKEN}</a>;
const Operator = 'Henry George Lowe trading as KURO Technologies, ABN 45 340 322 909, Melbourne, Victoria, Australia';

export const LEGAL_SECTIONS = {
  terms: {
    title: 'Terms of Service',
    meta: 'Last updated: 14 February 2026 · Version 1.0',
    body: (
      <>
        <Clause title="1. Operator. ">{Operator} ("we", "us", "KURO").</Clause>
        <Clause title="2. Acceptance. ">By accessing or using KURO OS, you agree to be bound by these Terms. If you do not agree, do not use the service. You must be at least 18 years of age to use KURO OS.</Clause>
        <Clause title="3. Service Description. ">KURO OS is an AI-powered operating system providing conversational AI, code execution, image generation, and related tools. AI inference runs on dedicated GPU hardware located in the United States. The platform uses third-party services including Cloudflare (security and CDN) and Stripe (payment processing). "Sovereign" refers to our architecture where AI models run on dedicated hardware not shared with other providers' training pipelines — it does not mean the platform operates without any third-party infrastructure services.</Clause>
        <Clause title="4. Accounts & Access. ">Access is via token-based authentication. You are responsible for maintaining the confidentiality of your access tokens. Notify us immediately at <Mail/> if you believe your token has been compromised.</Clause>
        <Clause title="5. Acceptable Use. ">You agree to comply with our Acceptable Use Policy. We reserve the right to suspend or terminate access for violations.</Clause>
        <Clause title="6. AI Output & Limitations. ">AI outputs are probabilistic and may contain errors, inaccuracies, or biases. Outputs do not constitute professional advice of any kind — including medical, legal, financial, engineering, or safety-critical advice. You are solely responsible for evaluating and acting on AI outputs. Code execution occurs in a sandboxed environment; however, you accept all risk associated with executing generated code.</Clause>
        <Clause title="7. Data & Privacy. ">Your use of KURO OS is also governed by our Privacy Policy. Conversations processed through KURO OS are not used to train AI models. Conversation data is stored on the inference server in the United States and subject to the retention periods described in our Privacy Policy.</Clause>
        <Clause title="8. Billing & Subscriptions. ">Paid plans are billed monthly via Stripe. Subscriptions renew automatically until cancelled. You may cancel at any time; cancellation takes effect at the end of the current billing period. No partial refunds are issued for the remaining days of a billing period after cancellation.</Clause>
        <Clause title="9. Australian Consumer Law. ">Nothing in these Terms excludes, restricts, or modifies any consumer guarantee, right, or remedy conferred by the Australian Consumer Law (Schedule 2 of the Competition and Consumer Act 2010). If the ACL applies to you as a consumer, our liability for failure to comply with a consumer guarantee is limited (where permitted) to resupplying the service or paying the cost of having the service resupplied.</Clause>
        <Clause title="10. Service Availability. ">We aim to provide reliable service but do not guarantee uninterrupted availability. We may suspend the service for maintenance, updates, security incidents, or circumstances beyond our control.</Clause>
        <Clause title="11. Limitation of Liability. ">To the maximum extent permitted by law and subject to clause 9, our total aggregate liability for any claims arising from or related to the service is limited to the total fees you have paid to us in the 12 months preceding the claim. We are not liable for any indirect, incidental, special, consequential, or punitive damages.</Clause>
        <Clause title="12. Disputes. ">Contact <Mail/>. We will attempt to resolve disputes informally within 30 days. If informal resolution is unsuccessful, disputes will be subject to the jurisdiction of the courts of Victoria, Australia, or the Victorian Civil and Administrative Tribunal (VCAT) where applicable.</Clause>
        <Clause title="13. Changes. ">We may update these Terms from time to time. Material changes will be communicated via the email address associated with your account. Continued use after changes constitutes acceptance.</Clause>
        <Clause title="14. Governing Law. ">These Terms are governed by the laws of Victoria, Australia.</Clause>
        <Clause title="15. Contact. "><Mail/></Clause>
      </>
    ),
  },

  privacy: {
    title: 'Privacy Policy',
    meta: 'Last updated: 14 February 2026 · Version 1.0',
    body: (
      <>
        <Clause title="Data Controller. ">{Operator}. Contact: <Mail/>.</Clause>
        <Clause title="What We Collect & Why." children={null} />
        <Sub label="Access tokens">Generated upon subscription. Used for authentication and session management. Stored server-side in encrypted configuration files.</Sub>
        <Sub label="Email address">Collected at subscription via Stripe. Used to deliver your access token and service communications. Not used for marketing.</Sub>
        <Sub label="Conversation data">Messages you send and AI responses. Processed by AI models on our dedicated GPU infrastructure for the purpose of providing the service.</Sub>
        <Sub label="Payment information">Processed entirely by Stripe. We do not store card numbers, CVVs, or bank details.</Sub>
        <Sub label="IP addresses & request metadata">Processed by Cloudflare for security, DDoS protection, and content delivery. Logged server-side in audit logs for security monitoring.</Sub>
        <Sub label="Usage metrics">Anonymised message counts and feature usage statistics. Not linked to individual users.</Sub>
        <Clause title="What We Do Not Do. ">We do not sell, rent, or trade your personal information. We do not use your conversations to train AI models. We do not use advertising or tracking cookies. We do not share data with advertisers or data brokers.</Clause>
        <Clause title="Where Data Is Stored & Processed. ">AI inference, conversation data, and session files are stored and processed on dedicated GPU servers located in the United States. Payment processing occurs through Stripe's infrastructure (global). Security and CDN services are provided by Cloudflare (global). By using KURO OS, you consent to this overseas transfer and processing of your data.</Clause>
        <Clause title="Third-Party Processors." children={null} />
        <Sub label="Cloudflare">CDN, DDoS protection, SSL termination. <a href="https://www.cloudflare.com/privacypolicy/" target="_blank" rel="noopener noreferrer">Privacy Policy</a></Sub>
        <Sub label="Stripe">Payment processing, subscription management. <a href="https://stripe.com/privacy" target="_blank" rel="noopener noreferrer">Privacy Policy</a></Sub>
        <Sub label="Brevo">Transactional email delivery. <a href="https://www.brevo.com/legal/privacypolicy/" target="_blank" rel="noopener noreferrer">Privacy Policy</a></Sub>
        <Clause title="Data Retention." children={null} />
        <Sub label="Conversation sessions">Retained for 90 days, then automatically purged.</Sub>
        <Sub label="Audit logs">Retained for 90 days. Government deployment profiles retain for up to 7 years as required.</Sub>
        <Sub label="Account & billing records">Retained for the duration of your subscription plus 7 years for tax and legal compliance (ATO requirements).</Sub>
        <Sub label="Access tokens">Active until revoked or subscription cancelled.</Sub>
        <Clause title="Security. ">Data in transit is encrypted via TLS 1.3 (Cloudflare). Authentication uses cryptographically generated tokens. Audit logs use Ed25519 cryptographic signatures for tamper detection. Server access is restricted to authorised personnel via SSH key authentication.</Clause>
        <Clause title="Your Rights. ">Under the Australian Privacy Act 1988, you have the right to access your personal information, request correction of inaccurate information, and request deletion of your data (subject to legal retention requirements). Email <Mail/>. We will respond within 30 days.</Clause>
        <Clause title="Complaints. ">If you believe we have breached the Australian Privacy Principles, contact <Mail/>. If unsatisfied, you may lodge a complaint with the Office of the Australian Information Commissioner (OAIC) at <a href="https://www.oaic.gov.au/privacy/privacy-complaints" target="_blank" rel="noopener noreferrer">oaic.gov.au</a> or 1300 363 992.</Clause>
        <Clause title="Cookies. ">See our Cookie Policy for details on cookies and similar technologies used by KURO OS.</Clause>
        <Clause title="Changes. ">We may update this Privacy Policy from time to time. Material changes will be communicated via the email address associated with your account.</Clause>
      </>
    ),
  },

  disclaimer: {
    title: 'Disclaimer',
    body: (
      <>
        <Clause title="AI Output. ">All AI-generated content is probabilistic and may contain errors, inaccuracies, hallucinations, or biases. Outputs should not be relied upon without independent verification.</Clause>
        <Clause title="Not Professional Advice. ">KURO OS does not provide and AI outputs do not constitute: medical or health advice; legal advice; financial, investment, or tax advice; engineering or safety-critical guidance; or any other form of professional advice. Always consult qualified professionals.</Clause>
        <Clause title="NeuroKURO. ">NeuroKURO's phase-reconstruction output is decision support only. It is not a diagnostic device, not medical advice, and not a substitute for clinical judgement. Validated against research cohorts — individual results will vary.</Clause>
        <Clause title="Code Execution. ">The DEV mode code execution environment is sandboxed, but you use it entirely at your own risk. We are not responsible for any data loss or system damage resulting from executing AI-generated code.</Clause>
        <Clause title="Image Generation. ">AI-generated images may not accurately represent reality. You are responsible for ensuring any generated images comply with applicable laws and do not infringe on the rights of others.</Clause>
        <Clause title="Service Accuracy. ">We do not guarantee that the service will be error-free, uninterrupted, or meet your specific requirements. Use the service at your own discretion and risk.</Clause>
      </>
    ),
  },

  aup: {
    title: 'Acceptable Use Policy',
    meta: 'Last updated: 14 February 2026',
    body: (
      <>
        <Clause title="Prohibited Activities. ">You may not use KURO OS to: generate, store, or distribute child sexual abuse material (CSAM); create content promoting violence, terrorism, or extremism; develop malware, phishing tools, or exploit code; harass, threaten, or stalk individuals; generate non-consensual intimate imagery or deepfakes of real people; circumvent security controls or access restrictions; perform automated scraping or denial-of-service attacks; resell or redistribute access tokens; produce content that violates Australian law or the law of your jurisdiction.</Clause>
        <Clause title="Enforcement. ">Violations are handled proportionally based on severity:</Clause>
        <Sub label="Minor violations">Written warning via email. Repeated minor violations may escalate.</Sub>
        <Sub label="Serious violations">Immediate temporary suspension pending review. We will notify you within 48 hours with details and an opportunity to respond.</Sub>
        <Sub label="Severe violations">Immediate permanent termination without prior notice. We may report to relevant law enforcement authorities as required by law.</Sub>
        <Clause title="Appeals. ">If your access has been suspended or terminated for a serious violation, appeal by emailing <Mail/> within 14 days of notification. Appeals will be reviewed within 14 business days. Severe violations (CSAM, terrorism) are not eligible for appeal.</Clause>
        <Clause title="Reporting. ">To report abuse or policy violations by another user, contact <Mail/>. We will acknowledge receipt within 48 hours and investigate promptly.</Clause>
        <Clause title="Monitoring. ">We maintain automated threat detection systems that filter harmful inputs. Audit logs record interactions for security purposes. We do not proactively monitor conversation content, but may review flagged sessions during investigations.</Clause>
      </>
    ),
  },

  cookie: {
    title: 'Cookie Policy',
    meta: 'Last updated: 14 February 2026',
    body: (
      <>
        <p>KURO OS uses a minimal set of cookies and browser storage technologies. We do not use advertising, tracking, or marketing cookies.</p>
        <Clause title="Essential Cookies " children=" (always active — required for the service to function)" />
        <table className="lgl-table">
          <thead><tr><th>Name</th><th>Provider</th><th>Purpose</th><th>Expiry</th></tr></thead>
          <tbody>
            <tr><td>__cf_bm</td><td>Cloudflare</td><td>Bot detection / security</td><td>30 min</td></tr>
            <tr><td>cf_clearance</td><td>Cloudflare</td><td>Security challenge clearance</td><td>30 min</td></tr>
            <tr><td>__cfruid</td><td>Cloudflare</td><td>Rate limiting</td><td>Session</td></tr>
            <tr><td>kuro_session</td><td>KURO OS</td><td>Authentication session</td><td>24 hours</td></tr>
          </tbody>
        </table>
        <Clause title="Local Storage " children=" (browser-side, not transmitted to servers)" />
        <table className="lgl-table">
          <thead><tr><th>Key</th><th>Purpose</th><th>Category</th></tr></thead>
          <tbody>
            <tr><td>kuro_token</td><td>Stores your access token for authentication</td><td>Essential</td></tr>
            <tr><td>kuro_cookies</td><td>Records your cookie consent choice</td><td>Essential</td></tr>
            <tr><td>kuro_demo_count</td><td>Tracks free demo message usage</td><td>Essential</td></tr>
            <tr><td>kuro_demo_week</td><td>Weekly reset counter for demo messages</td><td>Essential</td></tr>
          </tbody>
        </table>
        <Clause title="Third-Party Cookies " children=" (on payment pages only)" />
        <table className="lgl-table">
          <thead><tr><th>Name</th><th>Provider</th><th>Purpose</th></tr></thead>
          <tbody>
            <tr><td>__stripe_mid</td><td>Stripe</td><td>Fraud prevention during checkout</td></tr>
            <tr><td>__stripe_sid</td><td>Stripe</td><td>Checkout session management</td></tr>
          </tbody>
        </table>
        <Clause title="Analytics. ">KURO OS does not currently use any third-party analytics services. If we add analytics in the future, we will update this policy and request your consent before loading any analytics scripts.</Clause>
        <Clause title="Managing Cookies. ">Essential cookies cannot be disabled as they are required for the service to function. You can clear all browser cookies and local storage via your browser settings.</Clause>
        <Clause title="Your Consent. ">Your cookie consent preference is stored locally with a timestamp and version identifier. You can withdraw or change your consent at any time from this panel.</Clause>
      </>
    ),
    footer: 'cookie-consent',
  },
};

export const LEGAL_ORDER = ['terms', 'privacy', 'disclaimer', 'aup', 'cookie'];
export const LEGAL_LABELS = {
  terms:      'Terms of Service',
  privacy:    'Privacy Policy',
  disclaimer: 'Disclaimer',
  aup:        'Acceptable Use',
  cookie:     'Cookie Settings',
};
