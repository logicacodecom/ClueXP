---
name: ClueXP Industrial Response
colors:
  surface: '#131313'
  surface-dim: '#131313'
  surface-bright: '#393939'
  surface-container-lowest: '#0e0e0e'
  surface-container-low: '#1c1b1b'
  surface-container: '#20201f'
  surface-container-high: '#2a2a2a'
  surface-container-highest: '#353535'
  on-surface: '#e5e2e1'
  on-surface-variant: '#d4c5ab'
  inverse-surface: '#e5e2e1'
  inverse-on-surface: '#313030'
  outline: '#9c8f78'
  outline-variant: '#504532'
  surface-tint: '#fbbc00'
  primary: '#ffe2ab'
  on-primary: '#402d00'
  primary-container: '#ffbf00'
  on-primary-container: '#6d5000'
  inverse-primary: '#795900'
  secondary: '#b4c5ff'
  on-secondary: '#002a78'
  secondary-container: '#0053db'
  on-secondary-container: '#cdd7ff'
  tertiary: '#b4efff'
  on-tertiary: '#003640'
  tertiary-container: '#04dcff'
  on-tertiary-container: '#005d6d'
  error: '#ffb4ab'
  on-error: '#690005'
  error-container: '#93000a'
  on-error-container: '#ffdad6'
  primary-fixed: '#ffdfa0'
  primary-fixed-dim: '#fbbc00'
  on-primary-fixed: '#261a00'
  on-primary-fixed-variant: '#5c4300'
  secondary-fixed: '#dbe1ff'
  secondary-fixed-dim: '#b4c5ff'
  on-secondary-fixed: '#00174b'
  on-secondary-fixed-variant: '#003ea8'
  tertiary-fixed: '#aaedff'
  tertiary-fixed-dim: '#00d9fc'
  on-tertiary-fixed: '#001f26'
  on-tertiary-fixed-variant: '#004e5c'
  background: '#131313'
  on-background: '#e5e2e1'
  surface-variant: '#353535'
typography:
  display-lg:
    fontFamily: Archivo Narrow
    fontSize: 32px
    fontWeight: '700'
    lineHeight: '1.1'
    letterSpacing: -0.02em
  headline-md:
    fontFamily: Archivo Narrow
    fontSize: 24px
    fontWeight: '600'
    lineHeight: '1.2'
  headline-sm:
    fontFamily: Archivo Narrow
    fontSize: 20px
    fontWeight: '600'
    lineHeight: '1.2'
  body-lg:
    fontFamily: Archivo Narrow
    fontSize: 18px
    fontWeight: '400'
    lineHeight: '1.5'
  body-md:
    fontFamily: Archivo Narrow
    fontSize: 16px
    fontWeight: '400'
    lineHeight: '1.5'
  label-caps:
    fontFamily: Archivo Narrow
    fontSize: 12px
    fontWeight: '700'
    lineHeight: '1'
    letterSpacing: 0.05em
  button-text:
    fontFamily: Archivo Narrow
    fontSize: 16px
    fontWeight: '700'
    lineHeight: '1'
rounded:
  sm: 0.125rem
  DEFAULT: 0.25rem
  md: 0.375rem
  lg: 0.5rem
  xl: 0.75rem
  full: 9999px
spacing:
  unit: 4px
  gutter: 16px
  margin-mobile: 16px
  margin-desktop: 32px
  intake-gap: 12px
  fulfillment-gap: 24px
---

## Brand & Style
The design system is engineered for high-stress emergency environments where legibility and speed of interaction are critical. It employs an **Industrial-Minimal** aesthetic that balances urgency with operational calm. 

The visual narrative is "Information First." It avoids all decorative flourishes to reduce cognitive load. The interface transitions from a high-contrast **Intake Phase** (designed for rapid decision-making in outdoor sunlight) to a more spacious **Fulfillment Phase** (designed for monitoring and reassurance). The emotional response should be one of absolute reliability, transparency, and professional competence.

## Colors
This is a **Dark Mode Only** system. 
- **Core Surface:** Deep Charcoal (#0E0E0E) provides the base for maximum contrast.
- **Primary (Amber/Yellow):** Used for primary actions, progress pipes, and critical status updates. This color must maintain a high contrast ratio against the charcoal background for outdoor visibility.
- **Secondary (Trust Blue):** Reserved exclusively for human-fallback actions ("Call a person instead"). It acts as a visual "safety valve."
- **Neutral (Zinc/Grey):** Used for secondary surfaces and borders to distinguish between UI sections without adding visual noise.

## Typography
The system utilizes **Archivo Narrow** for its high information density and legibility. 
- **Intake Phase:** Uses `display-lg` for primary questions and `headline-md` for options to ensure visibility in motion or under stress.
- **Fulfillment Phase:** Shifts toward `body-lg` and `body-md` for status reports and instructions, increasing the white space around text to lower the user's heart rate.
- **Labels:** All technical metadata and timestamps use `label-caps` for a professional, logged-data feel.

## Layout & Spacing
The layout follows a 4px baseline grid. 
- **Intake Phase:** Compact spacing (`intake-gap`) to keep all related decision-points within a single viewport. Padding on buttons is generous (16px vertical) to provide large hit targets.
- **Fulfillment Phase:** Increased vertical rhythm (`fulfillment-gap`) and larger margins to signal a transition from "urgent action" to "monitored safety."
- **Grid:** A standard fluid grid with a maximum content width of 600px, centering the UI on larger screens to keep the focus tight and linear.

## Elevation & Depth
Depth is communicated through **Tonal Layering** rather than shadows. 
- **Level 0:** Base background (#0E0E0E).
- **Level 1:** Surface containers (#1A1A1A) used for card-based inputs or status blocks.
- **Level 2:** Active/Focused states (#262626).
- **Outlines:** Low-contrast 1px borders (#333333) are used to define boundaries on Level 1 containers. Shadows are avoided entirely to maintain the "flat-industrial" utility of the interface.

## Shapes
The shape language is precise and utilitarian. 
- **Buttons and Inputs:** Use a 4px radius (`rounded-sm`) for a rigid, industrial feel. 
- **Progress Pipes:** Rectangular with slight 2px rounding to resemble hardware LED indicators.
- **Status Badges:** Use 0px (Sharp) corners to distinguish them from interactive buttons.

## Components
- **TopAppBar:** Fixed position. Features a 24px "Shield" icon, "ClueXP" in bold caps, and a subtitle "Emergency Access" in `label-caps` Primary Amber.
- **Emergency Footer:** A persistent, 64px height button in Trust Blue (#2563EB) with white `button-text`. It must always sit at the bottom of the viewport.
- **Progress Indicator:** A 6-pipe horizontal meter. Filled pipes use Primary Amber; empty pipes use 20% opacity white.
- **Primary Buttons:** High-visibility Amber background with Black text. No gradients.
- **Input Fields:** Heavy 2px borders when focused. Background is a shade lighter than the base surface to indicate interactivity.
- **Cards:** Used in the Fulfillment phase for status updates. They should have a 1px border (#333333) and contain a timestamp in the top-right corner.