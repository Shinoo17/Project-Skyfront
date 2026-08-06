import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import { DoubleSide, NormalBlending, PlaneGeometry, ShaderMaterial } from 'three'

import { bakePlanform } from './planform'

/*
The vapour sheet a hard pull lays over the wing.

Not a shock cone. The cone is a compressibility effect that rides at one station on the
fuselage near Mach 1; this is condensation standing over a wing that is being loaded hard,
and it lives or dies with the pull rather than with the speed alone.

What the airshow photographs actually show, and what this draws: a cloud whose outline is
the wing's outline. It runs out along the leading-edge sweep to the tips, crosses the
fuselage between the roots so the two wings are one sheet rather than two clouds, sits on
the upper surface close enough to follow the spine over it, and only loses the shape aft of
the trailing edge, where it streams and shreds. So the shape is not written here at all —
features/flight/planform.js measures it off the airframe's own triangles, and this file is
the surface that wears it.

`condensation` is the same shape of contract the plume has with the burner: a ref the
flight loop writes, holding how much of the sheet is actually forming. Nothing in here
decides when vapour is allowed to appear; features/flight/condensation.js does, off the
flight model's load factor.
*/

// The sheet is a drape, so it needs enough vertices to follow the airframe under it — a
// coarse grid would cut the corner over the wing root and bury the sheet in the spine.
// Built once and shared: every aircraft on a range gets its own placement and its own baked
// planform, not its own grid.
let sheetGeometry
function getSheetGeometry() {
  if (!sheetGeometry) {
    sheetGeometry = new PlaneGeometry(1, 1, 128, 96)
    sheetGeometry.rotateX(-Math.PI / 2)
  }
  return sheetGeometry
}

const VAPOR_VERTEX_SHADER = /* glsl */ `
  uniform sampler2D uPlanform;
  uniform vec2 uTexel;
  uniform float uTime;
  uniform float uStrength;
  uniform float uHeightMin;
  uniform float uHeightScale;
  uniform float uStandoff;
  uniform float uBillow;
  uniform float uLayer;
  uniform float uLayerLift;
  uniform vec2 uWing;
  varying vec2 vGrid;
  varying vec3 vNormal;
  varying vec3 vView;

  // Height of the airframe's upper surface under this point, in the airframe's own units.
  float surfaceAt(vec2 grid) {
    return uHeightMin + (texture2D(uPlanform, grid).g * uHeightScale);
  }

  void main() {
    // The mesh is the footprint — the whole airframe in plan — one unit square before
    // scaling, so its own position is the lookup: 0 at the tail, 1 at the nose, and across
    // the span in z. The wing coordinate runs 0 at its trailing edge to 1 at its leading,
    // which is the only part of the footprint allowed to carry a thick sheet.
    vec2 grid = position.xz + 0.5;
    vGrid = grid;
    float wing = clamp((grid.x - uWing.x) / max(uWing.y - uWing.x, 1e-3), 0.0, 1.0);
    float span = (grid.y * 2.0) - 1.0;

    // The sheet stands off the skin rather than lying on it — it is a surface of constant
    // pressure, thickest where the suction peak is and lifting as it sheds off the back.
    // Everywhere else on the airframe the veil is thin enough to lie on the metal.
    float bulge = sin(3.14159265 * wing);
    float shed = smoothstep(uWing.x, uWing.x - 0.10, grid.x);
    float ripple =
      (sin((grid.x * -12.0) - (uTime * 2.1) + (span * 4.5) + (uLayer * 3.7)) * 0.14) +
      (sin((grid.x * -22.0) + (uTime * 1.3) - (span * 8.0) + (uLayer * 2.1)) * 0.07);
    // The stack fans out over the middle of the chord and closes again at the edges, so
    // the cloud has a section like a cloud — thickest where the suction is, tapering to
    // nothing where it is running out of reasons to exist.
    float lift =
      uStandoff +
      (((uLayerLift * uLayer * mix(0.3, 1.0, bulge)) +
        (uBillow * (bulge + (shed * 0.9) + ripple))) * mix(0.55, 1.0, uStrength));

    vec3 displaced = vec3(position.x, surfaceAt(grid) + lift, position.z);

    // The drape's own facing, read off the height field either side of this point. A flat
    // plane's normal would say the sheet is horizontal everywhere, including where it is
    // climbing over the spine.
    float slopeX = (surfaceAt(grid + vec2(uTexel.x, 0.0)) - surfaceAt(grid - vec2(uTexel.x, 0.0)))
      / (2.0 * uTexel.x);
    float slopeZ = (surfaceAt(grid + vec2(0.0, uTexel.y)) - surfaceAt(grid - vec2(0.0, uTexel.y)))
      / (2.0 * uTexel.y);

    vec4 mvPosition = modelViewMatrix * vec4(displaced, 1.0);
    vNormal = normalMatrix * normalize(vec3(-slopeX, 1.0, -slopeZ));
    vView = -mvPosition.xyz;
    gl_Position = projectionMatrix * mvPosition;
  }
`

const VAPOR_FRAGMENT_SHADER = /* glsl */ `
  uniform sampler2D uPlanform;
  uniform float uTime;
  uniform float uStrength;
  uniform float uLayer;
  uniform vec2 uEdge;
  uniform vec2 uWing;
  uniform vec2 uSize;
  uniform vec2 uOpacity;
  uniform vec2 uDensity;
  uniform float uFalloff;
  uniform float uHaze;
  varying vec2 vGrid;
  varying vec3 vNormal;
  varying vec3 vView;

  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
  }

  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
      mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x),
      f.y
    );
  }

  float fbm(vec2 p) {
    float sum = 0.0;
    float amp = 0.5;
    for (int i = 0; i < 4; i++) {
      sum += amp * noise(p);
      p *= 2.03;
      amp *= 0.5;
    }
    return sum;
  }

  void main() {
    vec4 planform = texture2D(uPlanform, vGrid);

    // Where the airframe can hold vapour at all, and it is the airframe that says so. The
    // outline comes in feathered, so the cloud fades in just inside the edge instead of
    // being cut off at it; the wake is that same outline smeared aft, which is what lets it
    // leave the trailing edge still shaped like what shed it. Each layer up sits inside the
    // one under it, so the stack has the section of a cloud rather than of a stack of decks.
    float inset = uLayer * 0.2;
    float sheet = smoothstep(uEdge.x + inset, uEdge.y + inset, planform.r);
    float wake = smoothstep(0.06 + inset, 0.55 + inset, planform.b) * 0.8;

    // How much of it is allowed here. Full over the wing and in the air just behind it,
    // where the suction peak is; a haze fraction of that everywhere else, the thin veil the
    // rest of the upper surface carries at the same alpha — enough to see, thin enough to
    // see the aircraft through.
    float overWing =
      smoothstep(uWing.y + 0.05, uWing.y - 0.03, vGrid.x) *
      smoothstep(uWing.x - 0.16, uWing.x - 0.02, vGrid.x);
    // And gone before the footprint runs out at any edge, so the nose, the tips and the far
    // end of the wake are the cloud giving up rather than the mesh ending. Outboard this is
    // only insurance — the margin past the tips is wide enough that the outline has already
    // faded out well inside it — so it is kept to the last cells of the grid.
    float ends =
      smoothstep(0.0, 0.05, vGrid.x) * (1.0 - smoothstep(0.94, 1.0, vGrid.x)) *
      smoothstep(0.0, 0.03, vGrid.y) * (1.0 - smoothstep(0.97, 1.0, vGrid.y));
    float profile = max(sheet, wake) * mix(uHaze, 1.0, overWing) * ends;

    // Two scales of cloud: a slow body drifting aft with the flow, and a finer shimmer that
    // keeps the edges alive without moving the sheet off its station. Sampled in airframe
    // units, so the grain is the same size whatever the footprint turned out to be.
    vec2 field = vGrid * uSize;
    float body = fbm((field * 1.16) + vec2(uTime * -0.30, uLayer * 5.0));
    float fine = fbm((field * 2.72) + vec2(uTime * -0.85, (uTime * 0.12) + (uLayer * 9.0)));
    float cloud = mix(body, fine, 0.35);

    // A weak pull condenses only the densest patches; a hard one closes them up. Same noise
    // field either way, so the cloud grows and heals rather than fading in. The window is
    // set against what this noise actually produces: four octaves halving in amplitude
    // average about 0.47, not 0.5, so a cut anywhere near a half would leave the patchy end
    // of the effect — which is most of it — showing nothing at all. The hard end of the cut
    // stays well above zero on purpose: a sheet that closes completely is a white blanket
    // with an aircraft somewhere under it.
    //
    // The edge asks more of that noise than the middle does. Where the cloud is running out
    // of reasons to exist it takes a denser patch to condense anything at all, so the sheet
    // comes apart into wisps on its way out instead of ending on a contour line — which is
    // what it did while the profile scaled the noise into the cut rather than raising it:
    // once coverage fell far enough, every pixel dropped under the threshold at once, and
    // the last pixels still standing were at full density. So coverage does not touch the
    // threshold any more. It goes back to being what it always was — how much cloud is
    // allowed here — and multiplies the alpha, which is the only form of it that can taper
    // to nothing.
    float cut = mix(uDensity.x, uDensity.y, uStrength) + (uFalloff * (1.0 - profile));
    float density = smoothstep(cut, cut + 0.24, cloud);

    // A thin slab reads denser edge-on, because that is where the line of sight crosses
    // more of it — the opposite of the plume, which is brightest through its core.
    float facing = abs(dot(normalize(vNormal), normalize(vView)));
    float grazing = mix(1.0, 0.45, smoothstep(0.25, 0.95, facing));

    float alpha =
      density * profile * grazing * mix(uOpacity.x, uOpacity.y, uStrength) *
      mix(1.0, 0.6, uLayer) * smoothstep(0.0, 0.12, uStrength);
    if (alpha < 0.004) discard;

    // Cloud, lit by nothing in particular: white where it is thick, cooler and greyer
    // where it is thinning out, which is how condensation reads against a bright sky.
    vec3 color = mix(vec3(0.78, 0.82, 0.88), vec3(1.0, 1.0, 1.0), density * profile);

    gl_FragColor = vec4(color, alpha);
  }
`

export default function VaporSheets({ aircraft, model, condensation }) {
  const tuning = aircraft.flight.condensation
  const sheets = useRef([])

  // One bake per airframe, at mount. Everything that follows the wing rather than the
  // pull — the outline, the drape, the wake — is fixed by the geometry, so it is measured
  // once and never touched again.
  const planform = useMemo(
    () => (tuning ? bakePlanform(model, tuning) : null),
    [model, tuning],
  )

  // A sheet has depth as well as an outline. Stacking a few of them at increasing standoff,
  // each carrying its own patch of the same noise field, is what separates a cloud from a
  // decal — and it costs a handful of draw calls of a mesh that is hidden most of a sortie.
  const materials = useMemo(() => {
    sheets.current.length = 0
    if (!planform) return []
    const count = Math.max(1, tuning.layers ?? 1)
    return Array.from({ length: count }, (_, index) => {
      const layer = count > 1 ? index / (count - 1) : 0
      return new ShaderMaterial({
        vertexShader: VAPOR_VERTEX_SHADER,
        fragmentShader: VAPOR_FRAGMENT_SHADER,
        uniforms: {
          uPlanform: { value: planform.texture },
          uTexel: { value: planform.texel },
          uTime: { value: 0 },
          uStrength: { value: 0 },
          uHeightMin: { value: planform.heightMin },
          uHeightScale: { value: planform.heightScale },
          uStandoff: { value: planform.chord * tuning.standoff },
          uBillow: { value: planform.chord * tuning.billow },
          uLayerLift: { value: planform.chord * (tuning.layerLift ?? 0) },
          uLayer: { value: layer },
          uEdge: { value: tuning.edge ?? [0.35, 0.8] },
          uWing: { value: planform.wing },
          uSize: { value: [planform.scale[0], planform.scale[2]] },
          uOpacity: { value: tuning.opacity ?? [0.2, 0.5] },
          uDensity: { value: tuning.density ?? [0.46, 0.26] },
          uFalloff: { value: tuning.falloff ?? 0.3 },
          uHaze: { value: tuning.haze ?? 0.3 },
        },
        transparent: true,
        blending: NormalBlending,
        // Depth tested but never written: the airframe is drawn first and correctly hides
        // whatever of the sheet passes inside it, while the layers stay unsorted between
        // themselves and blend into one another.
        depthWrite: false,
        depthTest: true,
        side: DoubleSide,
      })
    })
  }, [planform, tuning])

  useEffect(() => () => {
    materials.forEach((material) => material.dispose())
    planform?.texture.dispose()
  }, [materials, planform])

  useFrame((state) => {
    if (!materials.length) return

    const { level } = condensation.current
    // Nothing to draw below the threshold, and a hidden mesh costs neither a draw call nor
    // a sort — a sortie spends most of its time well under any pull that makes vapour.
    const visible = level > 0.01
    sheets.current.forEach((sheet) => {
      if (sheet) sheet.visible = visible
    })
    if (!visible) return

    materials.forEach((material) => {
      material.uniforms.uTime.value = state.clock.elapsedTime
      material.uniforms.uStrength.value = level
    })
  })

  if (!planform) return null

  return (
    <>
      {materials.map((material, index) => (
        <mesh
          // The layers are a fixed stack built from the airframe, not a list that reorders.
          key={index}
          ref={(mesh) => { sheets.current[index] = mesh }}
          geometry={getSheetGeometry()}
          material={material}
          position={planform.position}
          scale={planform.scale}
          renderOrder={10 + index}
          frustumCulled={false}
          visible={false}
        />
      ))}
    </>
  )
}
