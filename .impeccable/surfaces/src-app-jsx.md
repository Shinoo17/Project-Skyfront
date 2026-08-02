---
version: 1
slug: "src-app-jsx"
primary_target: "src/App.jsx"
related_targets: ["src/components/Scene.jsx","src/components/Interface.jsx","src/styles.css"]
---

## Scope and mode

`src/App.jsx` is the sole application surface. Visitor mode: Experience.

## Audience, job, and task

The audience inspects the supplied F-22 model. The primary task is to orbit and zoom the aircraft, play every embedded animation clip, scrub its time, adjust playback speed, reset or preset the camera, and switch to manual flight for direct pitch, roll, and yaw control.

## Content and constraints

The supplied `public/F22_model.glb` and textures are the only factual artifacts. Do not add aircraft performance claims. The black theme is binding. Desktop and mobile must both keep the model unobstructed. Animation playback and direct Three.js surface control are mutually exclusive modes.

## Chosen direction

Radar Test Cell: a full-bleed 3D aircraft under cold directional light with restrained amber orientation marks. The memorable moment is the aircraft emerging from darkness while the real clip timeline begins moving.

## Unresolved decisions

The primary audience and any desired model attribution are not yet specified.
