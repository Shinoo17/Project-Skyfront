---
version: 1
slug: "src-app-jsx"
primary_target: "src/App.jsx"
related_targets: ["src/components/Scene.jsx","src/components/Interface.jsx","src/components/TestFlight.jsx","src/components/TestFlightScene.jsx","src/styles.css"]
---

## Scope and mode

`src/App.jsx` is the sole application surface. Visitor mode: Experience.

## Audience, job, and task

The audience inspects the supplied F-22 model and can enter a separate Test Flight range. The primary tasks are to orbit and zoom the aircraft, control every embedded animation, use direct manual attitude control, or fly through the supplied mountain map with keyboard or touch input.

## Content and constraints

The supplied `public/F22_model.glb`, `public/Mountain_Valley_Colorado.glb`, and embedded textures are the only factual artifacts. Do not add aircraft performance claims. The black theme is binding for interface chrome. Desktop and mobile must both keep the aircraft unobstructed. Test Flight must use an explicitly low-resource render configuration.

## Chosen direction

Radar Test Cell: a full-bleed 3D aircraft under cold directional light with restrained amber orientation marks. Test Flight extends the same instrument language into an unobstructed daylight chase view. The memorable moments are the aircraft emerging from darkness in the viewer and the mountain range opening behind it in flight.

## Unresolved decisions

The primary audience and any desired model attribution are not yet specified.
