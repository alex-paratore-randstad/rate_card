# Design System & Branding Guidelines: Domo Mapping Manager

This document defines the visual identity, typography, and design principles for the Domo Mapping Manager, synthesizing the 'Remix of Domo Mapping Manager' Stitch project and the official Randstad Brand Identity.

## 1. Core Brand Identity
**Creative North Star:** "The Orchestrated Insight"
The Domo Mapping Manager transforms complex data mapping into an editorial-grade, high-end command center. It prioritizes clarity, precision, and a "borderless" aesthetic to eliminate clutter and focus on data relationships.

### Voice & Tone
- **Primary Tone:** Professional & Strategic (Trusted Advisor).
- **Perspective:** "We" (Collective expertise).
- **Complexity:** Business Professional (Grade 10–12).
- **Key Adjectives:** Authoritative, Precise, Visionary.

---

## 2. Color Palette

### Primary Branding (Randstad)
- **Primary Blue:** `#255CA9` (Custom Primary)
- **Secondary Blue:** `#415E7D`
- **Tertiary Teal:** `#007C82`

### Functional & Indicator Colors
These strictly follow the Randstad Status guidelines:
- **Error / High Risk:** `#E00F0F` (Red)
- **Warning / Medium Risk:** `#E9A204` (Yellow)
- **Success / Low Risk:** `#257F56` (Green)

### UI Surface & Layering (Stitch)
Hierarchy is achieved through tonal shifts rather than borders:
- **Base Surface:** `#F8F9FF` (`surface`)
- **Sub-sections:** `#EEF4FF` (`surface-container-low`)
- **Active Workspaces:** `#FFFFFF` (`surface-container-lowest`)
- **Text (Primary):** `#001D35` (`on_surface`) - *Never use 100% black.*

### Data Visualization Palettes
Use the following sequences for charts and graphs:
- **Categorical (1-4 Items):** `#255CA9`, `#BAD808`, `#007C82`, `#B2CFF2`
- **Time-Based (PoP):** `#255CA9`, `#729DF1`, `#BAD808`, `#709100`, `#9BD6E6`
- **Line Charts:** `#1A509C`, `#BBD900`, `#258AED`, `#00C6CC`

---

## 3. Typography
Typography provides an editorial foundation for high-density data.

- **Primary Font (Headings):** **Inter** (Bold/Semi-bold)
  - Use `display-md` (2.75rem) for dashboard metrics.
  - H2 for major sections, H3 for sub-sections.
- **Secondary Font (Body):** **Source Sans Pro** (Regular)
  - Standard table cell content and data entry.
- **Metadata/Labels:** **Inter** (Small, 0.6875rem) with `0.05em` letter-spacing for a "pro-tool" look.

---

## 4. Design Principles & Constraints

### The "No-Line" Rule
**Strict Constraint:** 1px solid borders are prohibited.
- Boundaries must be defined by background color shifts (`surface` vs `surface-container-low`) or white space.
- **Exception:** If a boundary is absolutely required for accessibility, use `#C2C6D3` at **15% opacity** (a "Ghost Border").

### The "No Gradient" Rule
**Strict Constraint:** Do not use gradients in charts, icons, or UI elements. All colors must be flat hex codes. 
*(Note: This overrides earlier Stitch suggestions for gradient CTAs to align with Randstad branding.)*

### Spacing & Elevation
- **Breathing Room:** Maintain 16px–24px internal padding for table cells.
- **Ambient Shadows:** Only for floating elements (modals/dragging). Use 24px blur at 6% opacity, tinted with `#001D35`.
- **Vertical Hierarchy:** Separate rows using a 4px vertical gap and alternating background colors rather than dividers.

---

## 5. Visual Consistency
- **Image Style:** Minimalist Photorealism or Flat Vector illustrations (thin lines, no gradients).
- **Mood:** Sophisticated & Analytical. Cool lighting (blue/teal tones).
- **Formatting:**
  - **Dates:** DD Month YYYY (e.g., 06 April 2026).
  - **Currency:** Include code and symbol (e.g., USD $100).
  - **Lists:** Always use the Oxford Comma.

---

## 6. Prohibited Elements (Negative Constraints)
- No Cartoons or Clichés.
- No Slang or Emojis.
- No Decorative Borders.
- No Warm Tones (Oranges/Pinks) outside of indicator colors.
- No maximalist/cluttered layouts.
