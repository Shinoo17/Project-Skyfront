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

Mission Control to Open Sky: the viewer is a mission-ready hangar terminal with compact live status, while Test Flight becomes a complete combat-training game HUD. The flight sightline prioritizes heading, attitude, speed, altitude, vertical speed, throttle, range position, flap state, and recovery advisories. The memorable moments are the aircraft framed for inspection in the dark hangar and the tactical HUD coming alive over the mountain range without obscuring the chase view.

## Unresolved decisions

The primary audience and any desired model attribution are not yet specified.
