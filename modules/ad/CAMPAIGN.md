# KURO::PAY — Pre-DAVAS Brand Seeding Campaign

**Goal:** Brand awareness among target persona (Western digital nomads, SEA travelers) ahead of DAVAS 2026. Not performance. Not direct user acquisition. Waitlist capture only.

## Budget & pacing

| Parameter | Value |
|---|---|
| Total spend cap | **$37.50 AUD** |
| Duration | 4 days |
| Daily cap | $6.25 AUD |
| Platform | Reddit Conversation Ads |
| Landing page | `kuroglass.net/pay` (waitlist capture — NOT live onboarding) |
| Enforcement | SQLite spend ledger, hard cap in renderer |

## Target subreddits

```
r/digitalnomad
r/solotravel
r/VietNam
r/ThailandTourism
r/SEABackpacking
r/Philippines
```

## Creative variants

Three variants, A/B/C rotation. Each renders at 1080×1080 for Reddit inline conversation ads.

| Variant | Copy | Emotional lever |
|---|---|---|
| **Fear**   | "Card declined in Da Nang at 11pm. KUROPay is already on your phone." | Anxiety — "what if" |
| **Logic**  | "The 3% isn't friction. It's margin. We charge 0.5%." | Economic rationality |
| **Expose** | "The QR works everywhere. Your card doesn't. Until now." | Revelation / information gap |

Platform line (footer on all variants): `Web · iOS coming soon`

## NeuroKURO scheduling (UTC+7)

Bid multipliers applied per-hour window by the dispatcher:

| Window (UTC+7) | Multiplier | Rationale |
|---|---|---|
| 06:00 – 12:00 | **1.0** | Peak morning commute + coffee-shop scroll |
| 16:00 – 21:00 | **0.7** | Early evening, still active |
| 12:00 – 16:00 | **0.3** | Afternoon dip |
| 21:00 – 06:00 | **0.1** (floor) | Overnight floor, not zero |

## Renderer constraints

- **Playwright** PNG renderer, `deviceScaleFactor: 2`
- **MD5 cache** on template+copy+variant hash — re-renders only on change
- **No `backdrop-filter`** in template CSS (breaks headless Chromium rendering at scale)
- No animation dependencies — templates must be fully-rendered at DOMContentLoaded
- Output: `1080×1080` PNG, sRGB
- Hard cap enforced at dispatcher level before each ad call

## File layout

```
modules/ad/
├── CAMPAIGN.md              # this doc
├── templates/
│   ├── fear.html            # Variant A
│   ├── logic.html           # Variant B
│   └── expose.html          # Variant C
└── (renderer, spend ledger, dispatcher — wired separately)
```

## Success metric

Not CPA. Not ROAS. The only metric that matters:

> **Reddit comment reply rate on the ads.**

If DAVAS attendees (or their pre-attendee research) mention "I saw a Reddit ad for this" in a meeting, the campaign paid off a thousand times over the $37.50.
