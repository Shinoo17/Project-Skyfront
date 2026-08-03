---
name: F-22 Raptor Combat Flight Interface
description: An aircraft-first hangar and combat-training HUD for interactive model inspection and flight.
colors:
  void-black: "#050709"
  hangar-black: "#0b0f12"
  carbon-panel: "#12171c"
  fog-white: "#dae2e6"
  instrument-ash: "#87949b"
  dormant-steel: "#59656b"
  radar-ice: "#9ad7e8"
  hud-phosphor: "#62ff84"
  caution-amber: "#ffb74a"
  warning-red: "#ff6b5f"
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

# Design System: F-22 Raptor Combat Flight Interface

## Overview

**Creative North Star: "Mission Control to Open Sky"**

The viewer behaves like a mission-ready hangar terminal, then opens into a legible combat-flight game HUD in the Test Flight range. Every readout comes from real scene or control state. The aircraft stays central while navigation, attitude, speed, altitude, throttle, range position, and aircraft configuration remain readable in peripheral vision.

**Key Characteristics:**

- Aircraft-first, full-bleed game composition
- Near-black tonal layers with cold, directional illumination
- Condensed instrument labels used for identity, status, measurement, and controls
- Ice-blue hangar activity and a single phosphor-green Test Flight HUD
- Thin vector brackets and attitude marks instead of card-heavy overlays
- Flat control surfaces; depth belongs primarily to the 3D scene

## Colors

The palette is almost achromatic, with ice blue marking hangar systems and phosphor green owning the complete Test Flight HUD.

### Primary

- **Radar Ice** (#9ad7e8): Active animation, online state, focus, and cold scene lighting.
- **HUD Phosphor** (#62ff84): The only foreground hue on the Test Flight HUD: projected symbology, tapes, readouts, advisories, tacmap, touch controls, and the desktop key legend. Brightness, opacity, shape, labels, and alert animation carry hierarchy instead of additional hues. Canvas marks use a wider translucent green pass instead of a black outline.

### Secondary

- **Caution Amber** (#ffb74a): Rare directional and classification marks; never a general decorative accent.
- **Warning Red** (#ff6b5f): Immediate terrain and range-limit warnings only.

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

**The Sightline Floor.** The `micro` (7px) and `label` (8px) tokens are hangar sizes, read from a resting cursor. Nothing in Test Flight goes below **10px**: the pilot is reading it in peripheral vision, in motion, over moving terrain. Glass labels are 10–12px, boxed values 15–16px, and the heading readout 15px. Bezel labels are 10–11px with 13–14px values. Raising the global tokens to this floor would change the hangar surface too, so the floor is stated here rather than retokenized.

## Layout

The 3D canvas occupies the full viewport. A fixed 82px command bar anchors the top and a 304px hangar control surface occupies the right edge on desktop.

Test Flight removes the side panel and composes on two planes. The **glass** is a single 2D canvas over the whole viewport carrying the sightline: heading tape at top centre, pitch ladder and flight path marker on the boresight, speed and altitude tapes flanking it, and a status block beneath. The **bezel** is opaque DOM clamped to the frame edges: the tacmap at upper right, the control deck along the bottom, the key legend under it. Nothing on the glass sits behind the bezel, and nothing on the bezel sits on the sightline.

Glass geometry is proportional to the frame, not fixed: a half-frame of `min(42vw, 72vh)` sets tape spacing, ladder width, and the heading tape's rise, which is clamped so the heading readout clears the command bar. Below 760px the tacmap and key legend drop out and the glass picks up the flap and range-edge readouts they were carrying; in short landscape windows the tacmap drops and the status columns pull inward. Primary flight readouts stay clear of the aircraft at every size.

## Elevation & Depth

The aircraft and its directional light provide the primary depth. Interface surfaces are flat and separated by tonal layers and single hairlines. The control panel alone carries a low, offset ambient shadow because it physically floats over the canvas.

### Shadow Vocabulary

- **Panel float** (`16px 24px 54px rgba(0, 0, 0, 0.34)`): Desktop control surface only.
- **Live point** (`0 0 12px rgba(154, 215, 232, 0.5)`): Tiny online indicators only.
- **Instrument halo** (`rgba(2, 8, 11, 0.78)`, 2.4px wider than the stroke it sits under): HUD glass only. An occlusion outline that keeps symbology readable over both sky and terrain — never used as elevation, and never on the bezel.

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

### Flight HUD

Heading, attitude, speed, altitude, vertical speed, throttle, ground clearance, range position, flap state, and advisories form one sightline. Data is tabular and updates without layout shift. Every HUD foreground uses HUD Phosphor; configuration and danger remain distinguishable through their labels, icons, brightness, and alert animation rather than a second hue. Weapons and targeting states must truthfully show unavailable or safe until those systems exist.

**The Projection Rule.** Anything attitude-shaped — the pitch ladder, the horizon, the flight path marker — is projected from world space through the same camera the scene renders with, so it stays welded to the terrain the pilot is looking at. It is never faked from Euler angles. Anything scale-shaped — the tapes, the boxed readouts, the status block — is screen-fixed. A symbol that claims to point at the world must actually point at it.

**The Halo Rule.** The range runs from a sunlit sky down to shadowed rock, and no single scrim serves both. Every glass stroke and glyph uses a wider translucent green pass beneath a crisp phosphor mark, with no black outline. The canvas avoids CSS `filter`, which would recomposite the animating layer every frame.

**The One Symbol Rule.** The flight model integrates position straight along the airframe's forward vector, so boresight and flight path are the same direction. Draw one marker, not a gun cross and a velocity vector stacked on the same pixel.

**Sightline frame rate.** Flight state is never React state. The scene writes one mutable object per frame and the glass reads it from its own animation frame; React re-renders only when the advisory changes, which is also when it is announced.

### Animation Transport

Playback, restart, clip time, scrubber, and reset view share one horizontal rail. The primary play state is visually decisive; all other controls recede until hover or focus.

## Do's and Don'ts

### Do:

- **Do** keep the aircraft as the brightest and largest object in the viewport.
- **Do** use lines and readouts to clarify real state or interaction.
- **Do** make Test Flight feel like a complete game HUD without inventing capabilities.
- **Do** let active controls become brighter while inactive controls stay quiet.
- **Do** preserve a usable keyboard focus state and reduced-motion behavior.

### Don't:

- **Don't** invent weapons, targets, missions, performance units, or aircraft claims that are not supported by the application.
- **Don't** scatter neon glows, gradients on text, or decorative glass cards.
- **Don't** use rounded cards as the default container for every control group.
- **Don't** let interface chrome cover the aircraft on small screens.
