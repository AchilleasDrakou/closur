# Closur — Brand Guidelines

## Overview

Visual identity for Closur — AI coach for every hard conversation.

**Domain:** closur.ai
**Tagline:** "The life you want is on the other side of a few hard conversations."

### Core Copy

- **Landing hero:** "The life you want is on the other side of a few hard conversations."
- **Sub-hero:** "Practice any conversation with AI before it counts."
- **Video hook:** "I avoid hard conversations. So I built an AI that lets me practice them first."

---

## Colors

### Main Colors

| Name | Hex | Usage |
|---|---|---|
| Dark | `#141413` | Primary text, dark backgrounds |
| Light | `#faf9f5` | Light backgrounds, text on dark |
| Mid Gray | `#b0aea5` | Secondary elements |
| Light Gray | `#e8e6dc` | Subtle backgrounds |

### Accent Colors

| Name | Hex | Usage |
|---|---|---|
| Orange | `#d97757` | Primary accent — CTAs, alerts, key metrics |
| Blue | `#6a9bcc` | Secondary accent — info, coaching nudges |
| Green | `#788c5d` | Tertiary accent — success states, positive signals |

### Dashboard Override Colors (from session-dashboard)

These are the dark-mode dashboard-specific colors that layer on top of the brand palette:

| Name | Hex | Usage |
|---|---|---|
| BG | `#0a0a0f` | App background |
| BG Panel | `#0e0e14` | Panel backgrounds |
| BG Card | `#111116` | Card backgrounds |
| Border | `#1a1a22` | Default borders |
| Border Bright | `#2a2a3a` | Hover/active borders |
| Green Accent | `#b4e62e` | Primary UI accent (inherited from session-dashboard) |
| Red | `#ff3822` | Warnings, negative signals |
| Cyan | `#44aacc` | Info highlights |
| Yellow | `#ccaa33` | Caution states |

> **Note:** The dashboard uses the dark palette as primary. Brand main colors (`#141413`, `#faf9f5`) apply to marketing pages, export templates, and video assets. The dashboard UI uses the override palette above.

---

## Typography

### Fonts

| Role | Font | Fallback |
|---|---|---|
| Headings | Poppins | Arial |
| Body Text | Lora | Georgia |
| Code / Dashboard | Fira Code | monospace |
| Dashboard Sans | Space Grotesk | sans-serif |

### Application Rules

- **Headings (24pt+):** Poppins — clean, modern, professional
- **Body text:** Lora — warm, readable, approachable
- **Dashboard UI:** Fira Code (mono elements) + Space Grotesk (labels, headers)
- **Marketing / Video:** Poppins headings + Lora body
- Fallback to Arial/Georgia if custom fonts unavailable

---

## Text Styling

- Headings use brand dark (`#141413`) on light backgrounds, light (`#faf9f5`) on dark
- Body text maintains hierarchy with Mid Gray (`#b0aea5`) for secondary info
- Dashboard text uses `#b8b8b8` (text), `#5a5a6a` (dim), `#d8d8d8` (bright)

---

## Shape & Accent Usage

- Non-text shapes and decorative elements cycle through accent colors: orange → blue → green
- Coaching nudges use accent colors by urgency:
  - **Orange** — urgent ("Slow down", "You're losing them")
  - **Blue** — informational ("They mentioned budget", "Good pace")
  - **Green** — positive ("Great response", "Strong close")
- Charts and visualizations use the green accent (`#b4e62e`) as primary, red (`#ff3822`) for peaks/alerts

---

## Design Language

### Panel Style (from session-dashboard)
- Corner bracket decorations on panels (1px borders on corners only)
- No border-radius — sharp edges throughout
- Subtle border-left accents on list items
- Resizable panels with drag dividers

### Visual Motifs
- Contour lines / topographic patterns (from 3D terrain viz)
- Dot grids for compact metrics
- Sparkline mini-charts for trends
- Monospace uppercase labels with letter-spacing (`0.1em`)

### Tone
- Technical but approachable — "mission control for your sales calls"
- Dark, focused UI — minimal distraction during coaching
- Data-rich but not overwhelming — progressive disclosure
