---
version: 1
slug: "src-routes-testflightroute-jsx"
primary_target: "src/routes/TestFlightRoute.jsx"
related_targets: ["src/features/test-flight/FlightHud.jsx","src/features/test-flight/hud.js","src/features/test-flight/telemetry.js","src/features/test-flight/TestFlightScene.jsx","src/styles.css"]
---

## Scope and mode

`src/routes/TestFlightRoute.jsx` composes the Test Flight range. Visitor mode: Experience — the pilot is inside the work, so the interface recedes until it is needed. The route itself owns nothing visual; the HUD is `src/features/test-flight/FlightHud.jsx` (React shell and bezel) over `src/features/test-flight/hud.js` (the canvas painter), fed by `src/features/test-flight/telemetry.js`.

## Audience, job, and task

Someone flying the supplied F-22 over the supplied mountain map with keyboard or touch. The job is to stay oriented — heading, attitude, energy, and how much ground is left underneath — while the aircraft, not the interface, holds their attention. Every value on the HUD must be readable in peripheral vision, in motion, over terrain that ranges from sunlit sky to shadowed rock.

## Content and constraints

Airspeed is calibrated to the supplied F-22 performance table and shown in km/h with Mach beneath the speed box. Altitude, clearance, and range remain world units because the terrain has no declared real-world scale, so feet, metres, G, fuel, weapons, and targets must not be invented. The chase camera must stay unobstructed. The render profile keeps expensive effects off (DPR 1, 60 FPS, no AA, no shadows) and uses a display-synchronized loop, so the HUD may not add per-frame `filter` work or React re-renders.

## Chosen direction

Two materials, and the split is the whole design.

**Glass** — one 2D canvas over the full viewport. Attitude-shaped symbology (pitch ladder, horizon, flight path marker) is projected through the same camera the scene renders with, so it is welded to the real terrain rather than faked from Euler angles. Scale-shaped symbology (heading, km/h speed and altitude tapes, boxed values, Mach subreadout, status block) is screen-fixed. Every mark uses phosphor green with a translucent green under-pass and no black outline, staying legible without a scrim over the world.

**Responsive controls** — at 760px and below the touch control deck is visible and the keyboard legend is removed. Its A/B hold control can light reheat at any airspeed. Above 760px the touch deck is absent and the keyboard legend remains visible, including the Shift afterburner binding and short landscape desktop frames.

**Bezel** — opaque carbon DOM clamped to the frame edges: tacmap, control deck, key legend. Quiet by design, and the only copy a screen reader can reach. It never sits on the sightline, and the glass only picks up its readouts on frames narrow enough that the bezel has been dropped.

Flight state never becomes React state: the scene mutates one object per frame, the glass reads it from its own animation frame, and React re-renders only when the advisory changes — which is also the moment it is announced.

The render loop samples its own frame count into the telemetry object twice per second. A compact phosphor FPS readout sits at the upper right without causing React renders or overlapping the desktop tacmap.

The chase camera is 22 world units behind and 7 above the aircraft, with aircraft translation applied before the relative chase easing. The airframe stays visually prominent at every speed instead of shrinking under speed-dependent camera lag, while preserving forward visibility and HUD clearance.

Each engine carries a model-anchored additive exhaust plume. Military power stays short and violet; holding afterburner spools a longer warm core with turbulence and shock diamonds. The effect shares the viewer's implementation and adds no post-processing pass.

Advisories escalate on real numbers, in order: ground clearance from a downward raycast, then range edge, then ceiling, then flap configuration. `CLEAR → TERRAIN → PULL UP → TERRAIN · RANGE RESET` is a verified chain, and the reset is annunciated rather than silent.

## Unresolved decisions

The chase camera sits above the airframe, so the flight path marker — correctly at the velocity vector's vanishing point — reads well above the aircraft in level flight. Truthful, but a pilot new to it may read the gap as a fault; worth revisiting if the camera offset is ever tuned.

The primary audience and any desired model attribution are still unspecified.
