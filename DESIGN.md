---
name: F-22 Raptor Viewer
description: An aircraft-first radar test cell for interactive model inspection.
colors:
  void-black: "#050709"
  hangar-black: "#0b0f12"
  carbon-panel: "#12171c"
  fog-white: "#dae2e6"
  instrument-ash: "#87949b"
  dormant-steel: "#59656b"
  radar-ice: "#9ad7e8"
  caution-amber: "#ffb74a"
typography:
  display:
    fontFamily: "DIN Alternate, Arial Narrow, Aptos Narrow, sans-serif"
    fontSize: "clamp(2.875rem, 5.8vw, 5.5rem)"
    fontWeight: 800
    lineHeight: 0.85
    letterSpacing: "-0.025em"
  body:
    fontFamily: "-apple-system, BlinkMacSystemFont, Segoe UI, Helvetica, Arial, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.5
  instrument:
    fontFamily: "DIN Alternate, Arial Narrow, Aptos Narrow, sans-serif"
    fontSize: "0.5625rem"
    fontWeight: 600
    lineHeight: 1.4
    letterSpacing: "0.12em"
  micro:
    fontFamily: "DIN Alternate, Arial Narrow, Aptos Narrow, sans-serif"
    fontSize: "7px"
    fontWeight: 600
    lineHeight: 1.4
    letterSpacing: "0.13em"
  label:
    fontFamily: "DIN Alternate, Arial Narrow, Aptos Narrow, sans-serif"
    fontSize: "8px"
    fontWeight: 600
    lineHeight: 1.4
    letterSpacing: "0.12em"
  control:
    fontFamily: "DIN Alternate, Arial Narrow, Aptos Narrow, sans-serif"
    fontSize: "10px"
    fontWeight: 600
    lineHeight: 1.4
  title-sm:
    fontFamily: "DIN Alternate, Arial Narrow, Aptos Narrow, sans-serif"
    fontSize: "11px"
    fontWeight: 600
    lineHeight: 1.2
  title-md:
    fontFamily: "DIN Alternate, Arial Narrow, Aptos Narrow, sans-serif"
    fontSize: "13px"
    fontWeight: 600
    lineHeight: 1.2
  title-lg:
    fontFamily: "DIN Alternate, Arial Narrow, Aptos Narrow, sans-serif"
    fontSize: "15px"
    fontWeight: 700
    lineHeight: 1.2
  identity:
    fontFamily: "DIN Alternate, Arial Narrow, Aptos Narrow, sans-serif"
    fontSize: "19px"
    fontWeight: 700
    lineHeight: 1.2
rounded:
  datum: "2px"
  control: "3px"
  soft: "8px"
  sheet: "14px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "16px"
  lg: "24px"
  xl: "32px"
components:
  transport-primary:
    backgroundColor: "{colors.fog-white}"
    textColor: "{colors.void-black}"
    rounded: "{rounded.datum}"
    size: "44px"
  instrument-button:
    backgroundColor: "{colors.hangar-black}"
    textColor: "{colors.instrument-ash}"
    rounded: "{rounded.datum}"
    height: "38px"
    padding: "0 12px"
---

# Design System: F-22 Raptor Viewer

## Overview

**Creative North Star: "The Radar Test Cell"**

The interface behaves like a dark aerospace evaluation room: the aircraft is the instrument under test and the UI is only the calibrated equipment around it. It is immersive without pretending to be a game HUD. Sparse hairlines, mechanical readouts, and restrained signals provide orientation while the lit 3D object carries the emotion.

**Key Characteristics:**

- Aircraft-first, full-bleed composition
- Near-black tonal layers with cold, directional illumination
- Condensed instrument labels used only for identity, status, and measurement
- One ice-blue active state and rare caution-amber orientation marks
- Flat control surfaces; depth belongs primarily to the 3D scene

## Colors

The palette is almost achromatic, with ice blue marking live systems and amber reserved for orientation or caution.

### Primary

- **Radar Ice** (#9ad7e8): Active animation, online state, focus, and cold scene lighting.

### Secondary

- **Caution Amber** (#ffb74a): Rare directional and classification marks; never a general decorative accent.

### Neutral

- **Void Black** (#050709): Canvas and page ground.
- **Hangar Black** (#0b0f12): Control wells and secondary surfaces.
- **Carbon Panel** (#12171c): Elevated opaque control surfaces.
- **Fog White** (#dae2e6): Primary copy and decisive controls.
- **Instrument Ash** (#87949b): Secondary copy.
- **Dormant Steel** (#59656b): Inactive readouts and rules.

**The Live Signal Rule.** Radar Ice appears only when the system is active, interactive, or focused. Caution Amber appears only where the user needs a singular orientation cue.

## Typography

**Display Font:** DIN Alternate (with narrow system fallbacks)  
**Body Font:** Native system sans-serif  
**Label/Instrument Font:** DIN Alternate (with narrow system fallbacks)

**Character:** Compressed lettering feels cut into equipment rather than styled for a technology landing page. Ordinary prose remains in the native UI stack for clarity.

### Hierarchy

- **Display** (800, clamp(2.875rem, 5.8vw, 5.5rem), 0.85): Watermark-scale airframe identity only.
- **Title** (600, 0.8125rem, 1.2): Panel titles and aircraft identity.
- **Body** (400, 0.875rem, 1.5): Explanatory and recovery copy.
- **Label** (600, 0.5–0.625rem, 0.12em, uppercase): Status, units, timeline, and technical controls.

**The Instrument Type Rule.** Condensed uppercase text must name a state, measurement, identity, or action; it is not used as body copy.

## Layout

The 3D canvas occupies the full viewport. A fixed 82px command bar anchors the top, a 304px control surface occupies the right edge on desktop, and the animation transport spans the lower remaining width. On screens below 760px, the right panel becomes a user-invoked bottom sheet and the transport condenses to the lower edge. Spacing follows an 8px base rhythm, with 16–24px internal gaps and 28–32px viewport offsets.

## Elevation & Depth

The aircraft and its directional light provide the primary depth. Interface surfaces are flat and separated by tonal layers and single hairlines. The control panel alone carries a low, offset ambient shadow because it physically floats over the canvas.

### Shadow Vocabulary

- **Panel float** (`16px 24px 54px rgba(0, 0, 0, 0.34)`): Desktop control surface only.
- **Live point** (`0 0 12px rgba(154, 215, 232, 0.5)`): Tiny online indicators only.

## Shapes

Desktop controls use tight 2–3px corners, like cut aerospace panels. Circles are reserved for reticles, live status points, and switch knobs. The 14px sheet radius appears only on the mobile bottom sheet where it clarifies a draggable overlay.

## Components

### Buttons

- **Shape:** Tight datum corners (2–3px), never pill-shaped.
- **Primary:** Fog White on Void Black; the transport play control is a 44px square.
- **Hover / Focus:** Hover shifts toward Radar Ice and may rise by 2px; keyboard focus is a 2px Radar Ice ring.
- **Secondary:** Transparent with Instrument Ash text; Fog White on hover.

### Cards / Containers

- **Corner Style:** 3px on desktop, 14px only for the mobile sheet.
- **Background:** Layered Hangar Black and Carbon Panel.
- **Shadow Strategy:** Flat except for the floating desktop control surface.
- **Border:** One low-contrast cool hairline.
- **Internal Padding:** 16–24px.

### Navigation

The top command bar uses aircraft identity at left, operational state at center-right, and a single utility action at right. It remains one horizontal datum rather than a rounded navigation capsule.

### Animation Transport

Playback, restart, clip time, scrubber, and reset view share one horizontal rail. The primary play state is visually decisive; all other controls recede until hover or focus.

## Do's and Don'ts

### Do:

- **Do** keep the aircraft as the brightest and largest object in the viewport.
- **Do** use lines and readouts to clarify real state or interaction.
- **Do** let active controls become brighter while inactive controls stay quiet.
- **Do** preserve a usable keyboard focus state and reduced-motion behavior.

### Don't:

- **Don't** turn the interface into a fictional weapons HUD or add fabricated performance claims.
- **Don't** scatter neon glows, gradients on text, or decorative glass cards.
- **Don't** use rounded cards as the default container for every control group.
- **Don't** let interface chrome cover the aircraft on small screens.
