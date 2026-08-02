# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

The primary audience is not yet specified. The current build serves anyone who wants to inspect the supplied F-22 model interactively in a browser.

## Product Purpose

Present the supplied F-22 3D asset as an immersive, interactive viewer. Success means the aircraft loads reliably, can be examined from any angle, and every animation clip embedded in the model can be played and controlled.

## Operating Context

The viewer is a React + Vite web application using Three.js. It is intended to work with mouse, touch, and keyboard-capable browsers.

## Capabilities and Constraints

- Load `public/F22_model.glb` as the source model.
- Expose every embedded animation clip rather than hard-coding a single named action.
- Provide direct orbit, zoom, animation playback, timeline, speed, auto-rotation, and view-reset controls.
- Provide a clip-independent manual-flight mode that drives named control-surface nodes with Three.js quaternions and rotates the aircraft attitude from pitch, roll, and yaw input.
- Keep the experience responsive across desktop and mobile layouts.
- The supplied GLB contains 8 independent named clips: canopy, landing gear, tailhook, aerodynamic demo, and four left/right weapon-bay mechanisms. Open/deploy clips play in reverse when toggled off, and the viewer discovers future clips dynamically.

## Brand Commitments

- The user explicitly requires a cool black theme.
- The aircraft must remain the visual focus.

## Evidence on Hand

- `public/F22_model.glb`: the supplied aircraft with 8 independent animation clips.
- `public/textures/`: supplied original maps plus a web-optimized derivative set in `public/textures/web/` (2K for the main fuselage, 1K for supporting materials).
- No commercial claims, attribution copy, or external brand assets were supplied and none should be fabricated.

## Product Principles

- Let the aircraft lead the experience.
- Make model and animation state visible and controllable.
- Keep interaction immediate, legible, and reversible.
- Keep animation playback and manual flight mutually exclusive so the mixer cannot overwrite direct control input.
- Treat the supplied model and animation data as the source of truth.
