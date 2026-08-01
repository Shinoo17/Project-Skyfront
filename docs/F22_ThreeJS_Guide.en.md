# F-22 Raptor — glTF → Three.js Integration Guide

How to export `F22.blend` as glTF/GLB and drive its animation + textures yourself in Three.js.

Every number here was read from the actual file (`F22.blend`, Blender 5.2.0 LTS) and from a **real test export** whose GLB was then inspected. Nothing is guessed.

> Thai version: [`F22_ThreeJS_Guide.md`](F22_ThreeJS_Guide.md)

---

## 1. Model overview

| item | value |
|---|---|
| Main file | `F22.blend` |
| Blender | 5.2.0 LTS |
| Objects | 277 (265 meshes) |
| Triangles | ~39,040 |
| Materials | 7 |
| Armatures (rigs) | 9 |
| Scene FPS | **24** |
| Timeline | frame 1 – 972 (40.5 s) |
| Unit scale | 1.0 |
| Bounding box | X 4.29 × Y 3.10 × Z 1.06 (Blender units) |
| Textures | 28 PNG, ~85 MB total (`textures/`) |
| GLB (textures embedded) | 54.76 MB, 19 images |
| GLB (no textures) | 3.46 MB |

**Scale:** the real jet is 18.92 m long; the model is 4.29 units → multiply by **4.41** for meters.
(Or leave it and scale camera/physics to model units — just pick one and stick with it.)

**Axes:** Blender is Z-up, glTF/Three.js is Y-up. Conversion is `(x, y, z)_blender → (x, z, -y)_three`.

| direction | Blender | Three.js |
|---|---|---|
| Nose | +X | **+X** |
| Right wing | −Y | **+Z** |
| Left wing | +Y | −Z |
| Up | +Z | **+Y** |

So in Three.js: **roll = X axis, yaw = Y axis, pitch = Z axis.**

### 1.1 Object naming

Every part has been renamed systematically (from originals like `Fuselage.047`, `bLGrack.L.023`).
All 278 old→new mappings live in `F22_rename_map.json`; the revert script is `F22_revert_rename.py`.

Prefixes in use:

| prefix | meaning | approx count |
|---|---|---|
| `Body_`, `Wing_`, `Tail_` | structure + control surfaces | 15 |
| `MLG_*` | main landing gear, left/right | 56 |
| `NLG_*` | nose landing gear | 17 |
| `Bay_*` | weapon bays, doors, rails | 45 |
| `Canopy_*` | canopy assembly | 5 |
| `Cockpit_*`, `Seat_*` | interior | 90 |
| `Engine_Nozzle_*` | exhaust nozzles (thrust vectoring) | 9 |
| `Hook_*` | tailhook | 7 |
| `Wpn_*` | AIM-120 ×6, AIM-9M ×2 | 8 |
| `Light_*` | taxi / formation lights | 5 |
| `RIG_*` | armatures (no mesh) | 9 |

---

## 2. Rig architecture — read this before writing code

**Key idea: control mechanisms, not parts.**

The left main gear has 28 parts (strut, drag brace, upper/lower torque links, three door links, actuator rod, brake disc, wheel…) — and **you touch none of them**. Every part is parented to a bone of `RIG_MainGear_L`, and every bone is keyed. Play one clip and the whole linkage follows.

The part tables below are **reference material** (for hiding parts, swapping materials, raycasting), not a list of things you must animate.

### 2.1 Facts established by the test export

1. **You get 9 AnimationClips**, named after the armatures: `RIG_NoseGear`, `RIG_MainGear_L`, `RIG_MainGear_R`, `RIG_BayDoor_Center_L/R`, `RIG_BayDoor_Side_L/R`, `RIG_Canopy`, `RIG_Tail_Nozzle_Hook`.
   (Even with export mode `SCENE`, the exporter still splits per armature.)
2. All clips span **0.042 – 40.5 s** (frames 1–972), but **each clip only carries tracks for its own rig's bones**.
3. **0 skinned meshes** — every mesh is a plain node parented under a bone node ⇒ you can write transforms directly onto nodes (spin wheels, deflect control surfaces) with no skinning involved.
4. `track time = frame / 24` exactly → frame 1 = 0.04167 s, frame 972 = 40.5 s.

### 2.2 rig → bone → mesh

`RIG_Tail_Nozzle_Hook` (23 bones) — the catch-all rig: tailhook + control surfaces + nozzles.

| bone | attached parts | group |
|---|---|---|
| `Bone` | `Hook_Pivot` | tailhook |
| `Bone.003` | `Hook_Trunnion` | tailhook |
| `Bone.022` | `Hook_Shank_Upper`, `Hook_Shank_Arm`, `Hook_Point`, `Hook_Actuator` | tailhook (unkeyed — rides its parent) |
| `Bone.001` / `Bone.002` | `Tail_InterNozzle_Panel_L` / `_R` | inter-nozzle panels — **move with the hook** |
| `Bone.004` / `Bone.005` | `Tail_Stabilator_R` / `_L` | pitch |
| `Bone.006` / `Bone.007` | `Tail_VerticalFin_R` / `_L` | rudder (yaw) |
| `Bone.008` / `Bone.009` | `Wing_Flaperon_R` / `_L` | pitch + roll |
| `Bone.010` / `Bone.011` | `Wing_LEFlap_R` / `_L` | leading-edge flap |
| `Bone.012` / `Bone.013` | `Wing_Aileron_R` / `_L` | roll |
| `Bone.014` `.016` | upper nozzle flap R / L | thrust vectoring |
| `Bone.018` `.020` | lower nozzle flap R / L | thrust vectoring |
| `Bone.015` `.017` | upper nozzle vane R / L | |
| `Bone.019` `.021` | lower nozzle vane R / L | |

`RIG_MainGear_L` / `_R` (23 bones per side) — main parts:

| bone | parts |
|---|---|
| `Bone.008` | `MLG_x_Strut_Main` (+ Detail_01/05) |
| `Bone.014` | `MLG_Wheel_x`, `MLG_x_BrakeDisc`, `MLG_x_AxleFork` |
| `Bone.019` | `MLG_x_Door`, `MLG_x_DoorActuator`, `MLG_x_DoorLink_02` |
| `Bone` | `MLG_x_DragBrace`, `MLG_x_UpperLink` |
| `Bone.011` / `.012` | `MLG_x_TorqueLink_Upper` / `_Lower` |
| `Bone.006` | `MLG_x_Trunnion` |
| `Bone.010` | `MLG_x_SideBrace` |
| `Bone.009` | `MLG_x_BayFairing` |
| rest | `MLG_x_Detail_01..10`, `DoorLink_01/03`, `Pin_01`, `ActuatorRod`, `ShockCollar`, `UpperFitting` |

`RIG_NoseGear` (12 bones)

| bone | parts |
|---|---|
| `Bone.005` | `NLG_Strut_Outer`, **`Light_Taxi_L`, `Light_Taxi_R`** (taxi lights ride the nose strut) |
| `Bone.002` | `NLG_Strut_Inner`, `NLG_Wheel` |
| `Bone.009` | `NLG_Pivot_Pin`, `NLG_TorqueLink` |
| `Bone.003` | `NLG_LockLink_Upper/Mid/Lower` |
| `Bone.001` | `NLG_RetractActuator` |
| `Bone` | `NLG_DragBrace` |
| `Bone.007` / `.008` | nose gear doors R / L (`NLG_Door_Rail_x` + 3 hinge pins) |
| `Control` | control bone |

`RIG_BayDoor_Center_L` / `_R` — **drives both the center bay door AND the side bay door on that side**

| bone | parts |
|---|---|
| `Bone.002` | `Bay_Center_Door_x` + frame + hinge rod |
| `Bone.003` | center door edge / seal / strip |
| `Bone.009` `.010` `.011` `.004` | hinge arm, inner rib, outer rib, forward seal |
| `Bone` | `Bay_Side_Door_x_Inner` + lower frame |
| `Bone.001` | `Bay_Side_Door_x_Outer` + upper frame |
| `Bone.008` | side door hinge arm/pin |

`RIG_BayDoor_Side_L` / `_R` — AIM-9 trapeze launcher

| bone | parts |
|---|---|
| `Bone.007` | `Bay_Side_LauncherRail_x`, **`Wpn_AIM9M_x`** |
| `Bone.005` / `.006` | `Bay_Side_LauncherArm_x_Aft` / `_Fwd` |

`RIG_Canopy`

| bone | parts |
|---|---|
| `Bone` | `Canopy_Glass`, `Canopy_Frame_Rear`, `Canopy_Actuator` |
| `Bone.001` | `Canopy_Hinge_Arm` |
| `Bone.002` | `Canopy_Hinge_Bracket` |

---

## 3. Timeline (the animation showcase)

A single action named `Scene` holds the whole showcase back to back. Slice it with this table.

`t = frame / 24`

| # | move | frames | seconds | clip |
|---|---|---|---|---|
| 1 | **Canopy close** | 8 – 70 | 0.333 – 2.917 | `RIG_Canopy` |
| 2 | **Main gear up** | 111 – 181 | 4.625 – 7.542 | `RIG_MainGear_L`, `_R` |
| 3 | **Tailhook retract** | 116 – 188 | 4.833 – 7.833 | `RIG_Tail_Nozzle_Hook` |
| 4 | **Nose gear up** | 172 – 214 | 7.167 – 8.917 | `RIG_NoseGear` |
| 5 | **Weapon bay open** | 221 – 261 | 9.208 – 10.875 | `RIG_BayDoor_Center_L/R` |
| 5b | ↳ AIM-9 trapeze extends | 236 – 249 | 9.833 – 10.375 | `RIG_BayDoor_Side_L/R` |
| 6 | **Weapon bay close** | 301 – 342 | 12.542 – 14.250 | `RIG_BayDoor_Center_L/R` |
| 6b | ↳ AIM-9 trapeze retracts | 313 – 326 | 13.042 – 13.583 | `RIG_BayDoor_Side_L/R` |
| 7 | **Aero demo** (control surfaces + thrust vectoring) | 345 – 734 | 14.375 – 30.583 | `RIG_Tail_Nozzle_Hook` |
| 8 | **Nose gear down** | 741 – 781 | 30.875 – 32.542 | `RIG_NoseGear` |
| 9 | **Tailhook deploy** | 764 – 840 | 31.833 – 35.000 | `RIG_Tail_Nozzle_Hook` |
| 10 | **Main gear down** | 771 – 841 | 32.125 – 35.042 | `RIG_MainGear_L`, `_R` |
| 11 | **Canopy open** | 842 – 907 | 35.083 – 37.792 | `RIG_Canopy` |

⚠️ **Left and right bay doors are not keyed identically** — Center_L is 221–257, Center_R is 221–261; on closing, Center_R is 301–342 and Center_L is 305–342.
Cutting each side to its own numbers leaves one door ajar. **Use the union range 221–261 / 301–342 for both sides.**

Aero demo (row 7) broken down:

| frame range | what moves |
|---|---|
| 345 – 499 | rudders (`Tail_VerticalFin_L/R`) sweep |
| 351 – 530 | LE flaps + flaperons, first pass |
| 381 – 541 | stabilator pitch |
| 381 – 700 | upper/lower nozzle flaps — pitch vectoring, then differential (L/R opposed) |
| 542 – 700 | aileron roll |
| 560 – 734 | LE flaps + flaperons, second pass |

Measured values: nozzles deflect to **+16° / −20°** in pitch; from frame 542 onward left and right deflect in opposite directions (roll vectoring).

**State at frame 1:** canopy open (−20°), gear down, hook deployed, bays closed. There is no single frame where gear is down *and* hook is retracted, so don't rely on the glTF rest pose — set state explicitly at load (see §6.3).

---

## 4. Exporting from Blender

### 4.1 The recipe that was tested and works (recommended — textures embedded)

Run from Blender's Scripting tab (or via MCP):

```python
import bpy, os

OUT = "/path/to/your/game/public/models"
os.makedirs(OUT, exist_ok=True)

bpy.context.scene.frame_set(1)          # pin the rest pose so re-exports are reproducible

bpy.ops.export_scene.gltf(
    filepath=os.path.join(OUT, "F22_master.glb"),
    export_format='GLB',
    export_image_format='AUTO',          # embed textures in the file
    export_animations=True,
    export_animation_mode='SCENE',
    export_frame_range=True,
    export_bake_animation=False,
    export_def_bones=False,              # ⚠️ must be False or all non-deform bones are dropped
    export_apply=False,
    use_selection=False,
    export_cameras=False,
    export_lights=False,
    export_yup=True,
)
```

Actual result: **54.76 MB**, 265 meshes, 385 nodes, 7 materials, **19 images**, 9 animations, 0 skinned meshes (~13 s).

This is the **master** file — unoptimized. Never ship it directly; run it through §10 first.

> `export_def_bones=True` strips bones without vertex groups. This rig is pure bone-parenting with zero deform bones — so that flag wipes out every animation.

### 4.2 What the exporter does to textures automatically

The 26 PNGs in `textures/` collapse to **19 images** because the exporter packs them:

| what the exporter does | result |
|---|---|
| **Packs Metallic + Roughness into one ORM texture** (G = roughness, B = metallic) | `Cabin_Metallic-Cabin_Roughness`, `Landing_gear_Metallic-Landing_gear_Roughness`, … |
| **Merges Opacity into the base color's alpha channel** | `Cabin_Base_color-Cabin_Opacity`, `Landing_gear_Base_color-Landing_gear_Opacity` |
| Sets `alphaMode: MASK` on materials with opacity | `Interior_Cockpit_Bays`, `LandingGear` (cutoff defaults to 0.5) |
| Drops `Cockpit_+_details_Height.png` | not wired into the node tree |

`Airframe_Exterior` has no roughness file, so the exporter writes metallic into channel B, leaves G at white (255), and sets `roughnessFactor: 0.5` ⇒ a constant roughness of 0.5 across the airframe, matching Blender.

**So once loaded into Three.js the materials are ready to use** — no manual texture wiring needed (except the canopy, see §9).

### 4.3 Alternative — export without embedded textures

If you want per-texture control (resolution switching per device, streaming, swappable liveries), use:

```python
export_image_format='NONE',
```

That yields **3.46 MB** — all 7 materials still present with correct names, just no maps attached. Wire them up yourself per §8.

### 4.4 Verify the export

```python
import struct, json, sys
d = open(sys.argv[1], 'rb').read()
ln = struct.unpack('<I', d[12:16])[0]
j = json.loads(d[20:20+ln])
acc, bv = j['accessors'], j['bufferViews']

print('meshes', len(j['meshes']), 'nodes', len(j['nodes']),
      'mats', len(j.get('materials', [])),
      'images', len(j.get('images', [])),
      'skinned', sum(1 for n in j['nodes'] if 'skin' in n))

for a in j.get('animations', []):
    ts = [acc[s['input']] for s in a['samplers']]
    print(a['name'], len(a['channels']), 'ch',
          round(min(t['min'][0] for t in ts), 3), '->',
          round(max(t['max'][0] for t in ts), 3), 's')

for i, im in enumerate(j.get('images', [])):
    mb = bv[im['bufferView']]['byteLength'] / 1e6 if 'bufferView' in im else 0
    print(f'  img{i:>2} {im.get("name","?"):<48} {round(mb,2)} MB')

for m in j['materials']:
    p = m.get('pbrMetallicRoughness', {})
    print(' ', m['name'], '| alphaMode', m.get('alphaMode', 'OPAQUE'),
          '| slots', [k for k in ('baseColorTexture','metallicRoughnessTexture') if k in p]
                   + [k for k in ('normalTexture','emissiveTexture') if k in m])
```

You must see 9 animation lines and `skinned 0`.

### 4.5 ⚠️ Node names change once loaded into Three.js

`GLTFLoader` does two things to names:

1. Strips reserved characters `. [ ] : /` → `Bone.009` becomes **`Bone009`**.
2. Deduplicates: all 9 armatures contain `Bone`, `Bone.001`, etc., so they become `Bone`, `Bone_1`, `Bone_2`, … — **unpredictable**.

**Never look up a bone by name.** Look up the mesh (names are unique) and take its `.parent`:

```js
const boneOf = (name) => scene.getObjectByName(name).parent;
const flapL  = boneOf('Wing_Flaperon_L');   // = Bone.009 of RIG_Tail_Nozzle_Hook
```

---

## 5. Loading and setup in Three.js

```js
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;

// An environment map is essential — without it metal and glass render nearly black.
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

const gltf = await new GLTFLoader().loadAsync('/models/F22_game.glb');
const jet = gltf.scene;
scene.add(jet);

const clips = Object.fromEntries(gltf.animations.map(c => [c.name, c]));
// clips['RIG_MainGear_L'], clips['RIG_Canopy'], ...
```

With the embedded-texture export (§4.1) **materials arrive ready to use.** Only three things need adjusting:

```js
jet.traverse((o) => {
  if (!o.isMesh) return;
  const m = o.material;

  // 1. Anisotropy — GLTFLoader doesn't set it; fuselage panels blur at grazing angles.
  for (const k of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'emissiveMap'])
    if (m[k]) m[k].anisotropy = renderer.capabilities.getMaxAnisotropy();

  // 2. Brighten the cockpit MFD screens.
  if (m.name === 'Interior_Cockpit_Bays') m.emissiveIntensity = 1.2;

  // 3. Canopy glass — always override (see §9).
  if (m.name === 'Glass_Canopy') o.material = makeCanopyGlass(), o.renderOrder = 10;
});
```

If you're loading a KTX2 build (§10), wire the loaders first:

```js
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

const ktx2 = new KTX2Loader().setTranscoderPath('/basis/').detectSupport(renderer);
const loaderGLB = new GLTFLoader().setKTX2Loader(ktx2).setMeshoptDecoder(MeshoptDecoder);
```

---

## 6. Driving the animation

### 6.1 Principles

- **One armature = one `AnimationMixer`**, rooted at that armature's node.
  Bindings then resolve unambiguously despite bone names repeating across rigs.
- Don't let clips play on their own. **Scrub** them: write `action.time`, then call `mixer.update(0)`.
  That gives you a 0..1 progress value you can reverse mid-travel — exactly what gear and canopy need in a game.
- `AnimationUtils.subclip()` **drops tracks with no keys in the range.** A tailhook subclip (frames 116–188) therefore contains only `Bone`, `Bone.001`, `Bone.002`, `Bone.003`; every wing and nozzle bone falls out. **That means the mixer will never fight the control-surface code you write by hand** — this is why the architecture below is safe.

### 6.2 Mechanism class

```js
const FPS = 24;

class Mechanism {
  /**
   * @param rigRoot  the armature Object3D (e.g. scene.getObjectByName('RIG_MainGear_L'))
   * @param clip     AnimationClip
   * @param range    [startFrame, endFrame] in Blender frames — null uses the whole clip
   * @param seconds  how long the motion should take in game (seconds)
   */
  constructor(rigRoot, clip, range = null, seconds = null) {
    this.mixer = new THREE.AnimationMixer(rigRoot);

    this.clip = range
      // +1 because subclip treats endFrame as exclusive (frame >= endFrame is discarded)
      ? THREE.AnimationUtils.subclip(clip.clone(), `${clip.name}_sub`, range[0], range[1] + 1, FPS)
      : clip;

    this.action = this.mixer.clipAction(this.clip);
    this.action.loop = THREE.LoopOnce;
    this.action.clampWhenFinished = true;
    this.action.play();            // never pause — we drive time ourselves via update(0)

    this.duration = this.clip.duration;
    this.rate = 1 / (seconds ?? this.duration);   // progress per second
    this.t = 0;
    this.target = 0;
    this.#apply();
  }

  #apply() {
    this.action.time = Math.min(this.t * this.duration, this.duration - 1e-4);
    this.mixer.update(0);          // delta 0 = don't advance time, just apply the pose
  }

  set(v)   { this.target = THREE.MathUtils.clamp(v, 0, 1); }
  open()   { this.set(1); }
  close()  { this.set(0); }
  toggle() { this.set(this.target > 0.5 ? 0 : 1); }
  snap(v)  { this.t = this.target = THREE.MathUtils.clamp(v, 0, 1); this.#apply(); }

  get moving() { return this.t !== this.target; }
  get progress() { return this.t; }

  update(dt) {
    if (this.t === this.target) return;
    const step = this.rate * dt;
    this.t = this.t < this.target
      ? Math.min(this.target, this.t + step)
      : Math.max(this.target, this.t - step);
    this.#apply();
  }
}
```

> `mixer.setTime(t)` works as an alternative to `action.time` + `update(0)`, **but only if you never set `action.paused = true`** — a paused action has an effective timeScale of 0, so `setTime` moves nothing.

### 6.3 Wiring up the whole aircraft

```js
const rig = (n) => jet.getObjectByName(n);
const F   = (a, b) => [a, b];

const M = {
  // These rigs' clips contain only their own mechanism — subclipping is optional.
  canopy:    new Mechanism(rig('RIG_Canopy'),           clips['RIG_Canopy'],           F(842, 907), 2.5),
  noseGear:  new Mechanism(rig('RIG_NoseGear'),         clips['RIG_NoseGear'],         F(741, 781), 2.0),
  mainGearL: new Mechanism(rig('RIG_MainGear_L'),       clips['RIG_MainGear_L'],       F(771, 841), 3.0),
  mainGearR: new Mechanism(rig('RIG_MainGear_R'),       clips['RIG_MainGear_R'],       F(771, 841), 3.0),

  bayL:      new Mechanism(rig('RIG_BayDoor_Center_L'), clips['RIG_BayDoor_Center_L'], F(221, 261), 1.6),
  bayR:      new Mechanism(rig('RIG_BayDoor_Center_R'), clips['RIG_BayDoor_Center_R'], F(221, 261), 1.6),
  railL:     new Mechanism(rig('RIG_BayDoor_Side_L'),   clips['RIG_BayDoor_Side_L'],   F(236, 249), 0.6),
  railR:     new Mechanism(rig('RIG_BayDoor_Side_R'),   clips['RIG_BayDoor_Side_R'],   F(236, 249), 0.6),

  // The tail rig mixes hook + wings + nozzles, so the hook must be subclipped out.
  hook:      new Mechanism(rig('RIG_Tail_Nozzle_Hook'), clips['RIG_Tail_Nozzle_Hook'], F(764, 840), 1.8),
};

// Initial state: gear down, canopy closed, hook up, bays closed.
M.noseGear.snap(1); M.mainGearL.snap(1); M.mainGearR.snap(1);
M.canopy.snap(0); M.hook.snap(0);
M.bayL.snap(0); M.bayR.snap(0); M.railL.snap(0); M.railR.snap(0);

// Game-level API
const gear = {
  set(down) { M.noseGear.set(down ? 1 : 0); M.mainGearL.set(down ? 1 : 0); M.mainGearR.set(down ? 1 : 0); },
  get down()   { return M.mainGearL.progress > 0.99; },
  get moving() { return M.noseGear.moving || M.mainGearL.moving || M.mainGearR.moving; },
};
const bay = {
  set(open) { for (const k of ['bayL', 'bayR', 'railL', 'railR']) M[k].set(open ? 1 : 0); },
};

function update(dt) { for (const m of Object.values(M)) m.update(dt); }
```

**Note on direction:** in the source showcase, frames 771→841 are gear *extension*, so `progress 1 = gear down`. If you'd rather have `1 = up`, use the retraction range (111–181) and flip the semantics.

**Keyboard:**

```js
addEventListener('keydown', (e) => {
  if (e.repeat) return;
  switch (e.code) {
    case 'KeyG': gear.set(!gear.down); break;
    case 'KeyB': bay.set(M.bayL.progress < 0.5); break;
    case 'KeyC': M.canopy.toggle(); break;
    case 'KeyH': M.hook.toggle(); break;
  }
});
```

---

## 7. Parts you drive yourself (no clips)

### 7.1 Control surfaces — driven by input, not by playing a clip

The aero demo (frames 345–734) is eye candy. **Don't play it in game.** Write angles onto the bones from your pitch/roll/yaw input instead.

These bones live in the same rig as the hook, but the hook subclip carries no tracks for them, so writing over them is safe.
⚠️ That only holds for the per-armature export. If you loaded a build with a **single merged `Scene` clip**, that clip *does* key these bones and will fight you every frame — stop the mixer (or subclip the range you want) before writing angles by hand.

#### The hinge axis is the bone's own axis, not a world axis

🔴 **This is the mistake everyone makes.** Rotating a control surface about a straight world axis looks fine on the stabilators and wrong on everything else, because the real hinge lines are not axis-aligned.

Decompose the showcase clip and every keyed rotation on these ten bones comes out as a **pure rotation about the bone's local Y** — no exception, no off-axis component. Local Y already carries the geometry:

| surface | local Y in body frame | error if you use world `(0,0,1)` / `(0,1,0)` |
|---|---|---|
| `Tail_Stabilator_L/R` | `(0, 0, ∓1)` | 0° — the one case that looks right by luck |
| `Wing_Flaperon_L/R` | `(0.260, 0, ∓0.965)` | **15°** — trailing-edge sweep |
| `Wing_Aileron_L/R` | `(0.269, −0.042, ∓0.962)` | **15°** |
| `Wing_LEFlap_L/R` | `(−0.668, −0.027, ∓0.744)` | **42°** — leading-edge sweep |
| `Tail_VerticalFin_L/R` | `(0.335, 0.816, ∓0.471)` | **28°** — the outward cant |

The nozzle bones are the same story with a different letter: they hinge on their **local X**.

Because the axes mirror between left and right, flip each one against a shared reference so a positive angle means the same thing on both sides.

```js
// helper: hinge a part on its own bone axis, preserving the rest pose.
// Build these at load time, before you apply any attitude rotation to the jet.
function makeHinge(meshName, hingeAxis, reference) {
  const mesh = jet.getObjectByName(meshName);
  const bone = mesh.parent;                        // the bone node
  const rest = bone.quaternion.clone();
  const q = new THREE.Quaternion();

  const axis = hingeAxis.clone();
  const world = axis.clone().applyQuaternion(bone.getWorldQuaternion(new THREE.Quaternion()));
  if (world.dot(reference) < 0) axis.negate();     // point both sides the same way

  return (deg) => bone.quaternion.copy(rest).multiply(q.setFromAxisAngle(axis, deg * Math.PI / 180));
}

const SPAR   = new THREE.Vector3(0, 1, 0);   // control surfaces hinge on bone local Y
const NOZZLE = new THREE.Vector3(1, 0, 0);   // nozzle flaps and vanes hinge on bone local X

const STARBOARD = new THREE.Vector3(0, 0,  1);
const UP        = new THREE.Vector3(0, 1,  0);
const PORT      = new THREE.Vector3(0, 0, -1);

const surf = {
  stabL: makeHinge('Tail_Stabilator_L',  SPAR, STARBOARD),
  stabR: makeHinge('Tail_Stabilator_R',  SPAR, STARBOARD),
  flapL: makeHinge('Wing_Flaperon_L',    SPAR, STARBOARD),
  flapR: makeHinge('Wing_Flaperon_R',    SPAR, STARBOARD),
  ailL:  makeHinge('Wing_Aileron_L',     SPAR, STARBOARD),
  ailR:  makeHinge('Wing_Aileron_R',     SPAR, STARBOARD),
  leL:   makeHinge('Wing_LEFlap_L',      SPAR, STARBOARD),
  leR:   makeHinge('Wing_LEFlap_R',      SPAR, STARBOARD),
  rudL:  makeHinge('Tail_VerticalFin_L', SPAR, UP),
  rudR:  makeHinge('Tail_VerticalFin_R', SPAR, UP),
};
```

**With that normalisation, a positive angle always means:** trailing edge **down** on the horizontal surfaces, leading edge **up** on the LE flaps, trailing edge to **starboard** on the vertical tails.

#### Deflection limits, measured

Don't invent numbers — these are the peaks keyed in the showcase. Clamp to them, or a combined pitch + roll + flaps command will punch a surface through the wing.

| surface | limit |
|---|---|
| stabilator | ±20° |
| flaperon | ±22.6° |
| aileron | ±25° |
| LE flap | ±11.4° |
| vertical tail | ±22.6° |

#### Mixing

```js
const clamp = THREE.MathUtils.clamp;

// pitch/roll/yaw in -1..1
function applyControls({ pitch, roll, yaw, flaps = 0 }) {
  // Nose up needs the tail pushed down, so the stabilators — and the flaperons, which
  // act as elevons — go trailing edge UP. Rolling right needs more lift on the left
  // wing, so the LEFT surfaces go trailing edge down. Both tails deflect together for
  // yaw. The LE flaps droop with the flaps, which is negative here.
  surf.stabL(clamp(-pitch * 20 + roll * 8, -20, 20));
  surf.stabR(clamp(-pitch * 20 - roll * 8, -20, 20));
  surf.ailL(clamp( roll * 25, -25, 25));
  surf.ailR(clamp(-roll * 25, -25, 25));
  surf.flapL(clamp(-pitch * 10 + roll * 15 + flaps * 22, -22.6, 22.6));
  surf.flapR(clamp(-pitch * 10 - roll * 15 + flaps * 22, -22.6, 22.6));
  surf.leL(-flaps * 11);
  surf.leR(-flaps * 11);
  surf.rudL(yaw * 22);
  surf.rudR(yaw * 22);
}
```

> **Sanity check, not a guess.** Take the aft-most vertex of each surface and confirm which way it travels: pitch up ⇒ both stabilators TE up; roll right ⇒ left TE down and right TE up; yaw right ⇒ *both* tails TE to starboard; flaps ⇒ flaperons TE down and LE flaps drooped.
> On yaw the left tail's trailing edge also rises while the right one dips. **That is not a bug** — it is what a 28°-canted all-moving tail does when it rotates about its own spar.

### 7.2 Thrust vectoring nozzles

8 parts (upper/lower flap + upper/lower vane, × left/right). They hinge on **bone local X**, not the wing-span axis.

Normalise them against `PORT` and a positive angle means trailing edge **up** on all eight — i.e. the exhaust turns up, the tail is pushed down, the nose goes up.

```js
const nz = {
  LFlapU: makeHinge('Engine_Nozzle_L_Flap_Upper', NOZZLE, PORT),
  LFlapD: makeHinge('Engine_Nozzle_L_Flap_Lower', NOZZLE, PORT),
  LVaneU: makeHinge('Engine_Nozzle_L_Vane_Upper', NOZZLE, PORT),
  LVaneD: makeHinge('Engine_Nozzle_L_Vane_Lower', NOZZLE, PORT),
  RFlapU: makeHinge('Engine_Nozzle_R_Flap_Upper', NOZZLE, PORT),
  RFlapD: makeHinge('Engine_Nozzle_R_Flap_Lower', NOZZLE, PORT),
  RVaneU: makeHinge('Engine_Nozzle_R_Vane_Upper', NOZZLE, PORT),
  RVaneD: makeHinge('Engine_Nozzle_R_Vane_Lower', NOZZLE, PORT),
};

// One engine. v = -1..1, positive turns the exhaust up.
function vectorEngine(v, flapU, flapD, vaneU, vaneD) {
  const up = Math.max(v, 0), down = Math.max(-v, 0);
  flapU(up * 20 - down *  8);
  flapD(up *  8 - down * 20);
  vaneU(up * -10);
  vaneD(down * 10);
}

// vec = pitch vectoring, diff = roll vectoring
function applyVector(vec, diff = 0) {
  vectorEngine(THREE.MathUtils.clamp(vec - diff, -1, 1), nz.LFlapU, nz.LFlapD, nz.LVaneU, nz.LVaneD);
  vectorEngine(THREE.MathUtils.clamp(vec + diff, -1, 1), nz.RFlapU, nz.RFlapD, nz.RVaneU, nz.RVaneD);
}
```

The 20 / 8 / 10 numbers are the showcase's own, read off frames 381–700 and **exactly mirrored** between the up and down phases:

| frame | flap upper | flap lower | vane upper | vane lower |
|---|---|---|---|---|
| 420 (turning up) | +20° | +8° | +10° | 0° |
| 500 (turning down) | −8° | −20° | 0° | −10° |

(Angles as keyed, about each bone's local X. Note the vane always moves *opposite* to the flap on its side — it closes as the flap opens.)

From frame 542 the left and right engines run opposite sign at the same magnitude — that is the roll vectoring, and it is exactly what `diff` reproduces. For a right roll the **left** engine turns its exhaust down to lift that wing, hence `vec - diff` on the left.

### 7.3 Wheel spin — find the axis empirically

Wheels are plain mesh nodes under a bone, so you can rotate them directly. But **their local axis is not predictable** — rest transforms shift into bone space during export. Derive the axis from the world basis instead:

```js
function makeSpinner(meshName, worldAxis = new THREE.Vector3(0, 0, 1)) {
  const w = jet.getObjectByName(meshName);
  const local = worldAxis.clone()
    .applyQuaternion(w.getWorldQuaternion(new THREE.Quaternion()).invert())
    .normalize();
  return (rad) => w.rotateOnAxis(local, rad);
}

const spinNose = makeSpinner('NLG_Wheel');
const spinL    = makeSpinner('MLG_Wheel_L');
const spinR    = makeSpinner('MLG_Wheel_R');

// in the loop: omega = speed / radius
const RADIUS_MAIN = 0.11, RADIUS_NOSE = 0.066;   // Blender units
function spinWheels(speed, dt) {
  spinL(speed / RADIUS_MAIN * dt);
  spinR(speed / RADIUS_MAIN * dt);
  spinNose(speed / RADIUS_NOSE * dt);
}
```

**If a wheel spins in the wrong plane,** try `(1,0,0)` → `(0,1,0)` → `(0,0,1)` and keep whichever looks right. Thirty seconds of trial beats deriving it on paper.

⚠️ Don't spin wheels while a gear clip is playing. The clip writes the bone (parent) and you write the mesh (child), so they don't collide — but accumulated spin looks wrong as the leg folds. Spin only when `gear.down === true`.

---

## 8. Textures (Optional — only if you load them yourself)

> **With the embedded-texture export (§4.1) you can skip this entire section** — GLTFLoader wires up maps, colorSpace, flipY and alphaMode correctly on its own.
>
> Read on only if you exported with `export_image_format='NONE'` (§4.3) because you want to:
> - switch texture resolution per device tier
> - stream textures later (ship the 3.5 MB model first, fill in textures after)
> - swap liveries / skins at runtime
> - use your own ORM packing or texture atlas

### 8.0 What's actually in the files

Every file is a **PNG with no alpha channel** (plain RGB or grayscale) — there is no alpha to strip.

| map type | bit depth | size |
|---|---|---|
| Base color, Emissive | 8-bit RGB | 4096² (Weapons 1024²) |
| Metallic, Roughness, Opacity | 8-bit grayscale | 4096² |
| **Normal** | **16-bit RGB** | 4096² |
| Height (unused) | 16-bit grayscale | 4096² |

⚠️ 16-bit normals double the file size, but every GPU block format is 8-bit — convert to 8-bit before encoding.

Transparency lives in **separate opacity maps** (Substance Painter style), not in an alpha channel.
Measured coverage: `Cabin_Opacity` is 97.1% white / 1.0% black; `Landing_gear_Opacity` is **99.2% white with no black at all**.
⇒ They barely do anything. Try disabling them; if you see no difference, drop them — that's two fewer textures and no fragment discard.

### 8.1 Material table

7 materials; files live in `textures/`.

| material | meshes | Base color | Metallic | Roughness | Normal | other |
|---|---|---|---|---|---|---|
| `Airframe_Exterior` | 30 | `F22_Main_Fuselage_Base_color.png` | `..._Metallic.png` | ❌ none | `..._Normal_OpenGL.png` | |
| `Interior_Cockpit_Bays` | 144 | `Cabin_Base_color.png` | `Cabin_Metallic.png` | `Cabin_Roughness.png` | `Cabin_Normal_OpenGL.png` | `Cabin_Emissive.png`, `Cabin_Opacity.png` |
| `LandingGear` | 75 | `Landing_gear_Base_color.png` | `Landing_gear_Metallic.png` | `Landing_gear_Roughness.png` | `Landing_gear_Normal_OpenGL.png` | `Landing_gear_Opacity.png` |
| `Details_Exterior_Fittings` | 14 | `Cockpit_+_details_Base_color.png` | `..._Metallic.png` | `..._Roughness.png` | `..._Normal_OpenGL.png` | `..._Height.png` (unused) |
| `Details_Hook_TailUnderside` | 12 | `Tailhook_F_+_details_Base_color.png` | `..._Metallic.png` | `..._Roughness.png` | `..._Normal_OpenGL.png` | |
| `Weapons_Missiles` | 8 | `F22_RAPTOR_Weapons_Base_color.png` | `..._Metallic.png` | `..._Roughness.png` | `..._Normal.png` | |
| `Glass_Canopy` | 1 | — (see §9) | | | | |

### 8.2 Rules people get wrong

1. **`flipY = false` on every texture** — glTF uses the opposite UV convention from `TextureLoader`'s default. Forget it and everything is upside down.
2. **colorSpace**: `SRGBColorSpace` on base color and emissive only. The other four (metalness / roughness / normal / alpha) stay linear (default).
3. 🔴 **Set `metalness = 1.0` and `roughness = 1.0` whenever the matching map is assigned** — Three.js **multiplies** the scalar by the map. Blender's scalars are metallic 0.0 / roughness 0.5; copying those across while also assigning maps yields an aircraft with no metallic response at all.
4. **No need to pack ORM** — Three.js reads `.g` from `roughnessMap` and `.b` from `metalnessMap`; grayscale files already have r=g=b, so separate files work as-is.
5. **`Airframe_Exterior` has no roughness file** → use a scalar of ~0.45.
6. **Opacity maps → `alphaMap` + `alphaTest`**, not `transparent: true` (Blender's blend mode is HASHED, i.e. alpha clip).
7. **Normal maps are OpenGL convention (+Y), which already matches glTF.** No channel flip.
8. **Multi-material meshes become Groups** — `Canopy_Glass` and ~20 others (`Bay_Center_Door_L`, `MLG_L_Door`, `NLG_Door_Rail_L`…) export as 2 primitives, so `getObjectByName('Canopy_Glass').material` is `undefined`. **Traverse and switch on the material name instead.**

### 8.3 Code

```js
const TEX = '/textures/';
const loader = new THREE.TextureLoader();

function tex(file, srgb = false) {
  const t = loader.load(TEX + file);
  t.flipY = false;                                       // (1)
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;         // (2)
  t.anisotropy = renderer.capabilities.getMaxAnisotropy();
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

const MATERIALS = {
  Airframe_Exterior: new THREE.MeshStandardMaterial({
    name: 'Airframe_Exterior',
    map:          tex('F22_Main_Fuselage_Base_color.png', true),
    metalnessMap: tex('F22_Main_Fuselage_Metallic.png'),
    normalMap:    tex('F22_Main_Fuselage_Normal_OpenGL.png'),
    metalness: 1.0,        // (3)
    roughness: 0.45,       // (5) no map → scalar
    envMapIntensity: 1.0,
  }),

  Interior_Cockpit_Bays: new THREE.MeshStandardMaterial({
    name: 'Interior_Cockpit_Bays',
    map:          tex('Cabin_Base_color.png', true),
    metalnessMap: tex('Cabin_Metallic.png'),
    roughnessMap: tex('Cabin_Roughness.png'),
    normalMap:    tex('Cabin_Normal_OpenGL.png'),
    emissiveMap:  tex('Cabin_Emissive.png', true),
    emissive: 0xffffff, emissiveIntensity: 1.2,          // cockpit MFD screens
    alphaMap: tex('Cabin_Opacity.png'), alphaTest: 0.5,  // (6)
    metalness: 1.0, roughness: 1.0,
  }),

  LandingGear: new THREE.MeshStandardMaterial({
    name: 'LandingGear',
    map:          tex('Landing_gear_Base_color.png', true),
    metalnessMap: tex('Landing_gear_Metallic.png'),
    roughnessMap: tex('Landing_gear_Roughness.png'),
    normalMap:    tex('Landing_gear_Normal_OpenGL.png'),
    alphaMap: tex('Landing_gear_Opacity.png'), alphaTest: 0.5,
    metalness: 1.0, roughness: 1.0,
  }),

  Details_Exterior_Fittings: new THREE.MeshStandardMaterial({
    name: 'Details_Exterior_Fittings',
    map:          tex('Cockpit_+_details_Base_color.png', true),
    metalnessMap: tex('Cockpit_+_details_Metallic.png'),
    roughnessMap: tex('Cockpit_+_details_Roughness.png'),
    normalMap:    tex('Cockpit_+_details_Normal_OpenGL.png'),
    metalness: 1.0, roughness: 1.0,
  }),

  Details_Hook_TailUnderside: new THREE.MeshStandardMaterial({
    name: 'Details_Hook_TailUnderside',
    map:          tex('Tailhook_F_+_details_Base_color.png', true),
    metalnessMap: tex('Tailhook_F_+_details_Metallic.png'),
    roughnessMap: tex('Tailhook_F_+_details_Roughness.png'),
    normalMap:    tex('Tailhook_F_+_details_Normal_OpenGL.png'),
    metalness: 1.0, roughness: 1.0,
  }),

  Weapons_Missiles: new THREE.MeshStandardMaterial({
    name: 'Weapons_Missiles',
    map:          tex('F22_RAPTOR_Weapons_Base_color.png', true),
    metalnessMap: tex('F22_RAPTOR_Weapons_Metallic.png'),
    roughnessMap: tex('F22_RAPTOR_Weapons_Roughness.png'),
    normalMap:    tex('F22_RAPTOR_Weapons_Normal.png'),
    metalness: 1.0, roughness: 1.0,
  }),

  Glass_Canopy: makeCanopyGlass(),   // see §9
};

// (8) Traverse and swap by material name — works for both single Meshes and multi-primitive Groups.
function applyMaterials(root, table) {
  const missing = new Set();
  root.traverse((o) => {
    if (!o.isMesh) return;
    const name = o.material?.name;
    if (table[name]) o.material = table[name];
    else if (name) missing.add(name);
  });
  if (missing.size) console.warn('no material mapping for:', [...missing]);
}

applyMaterials(jet, MATERIALS);
```

---

## 9. Canopy glass

In Blender, `Glass_Canopy` is alpha 0.30, roughness 0.05, **metallic 0.85**, IOR 1.45, blend mode BLEND.
Those values can't be ported literally: in the PBR model **metals don't transmit light**, so high metalness and transmission fight each other. Pick one approach.

**What the exporter emits:** this material has no textures, so it exports as `baseColorFactor [0.30, 0.21, 0.09, 0.30]`, `metallicFactor 0.85`, `roughnessFactor 0.05`, `alphaMode: BLEND`, plus the `KHR_materials_ior` (1.45) and `KHR_materials_specular` extensions.
GLTFLoader builds a `MeshPhysicalMaterial` from that, but with **no transmission** (Blender's value is 0) and `depthWrite` still true, so the canopy occludes the cockpit. **Always override it in JS.**

`Canopy_Glass` has two material slots (`Details_Exterior_Fittings` = frame, `Glass_Canopy` = glass), so it arrives as a Group of 2 meshes. `applyMaterials` above handles that.

### Option A — tinted metal (recommended for a game; no extra pass)

Reproduces the F-22's gold ITO coating and stays cheap.

```js
function makeCanopyGlass() {
  return new THREE.MeshPhysicalMaterial({
    name: 'Glass_Canopy',
    color: 0xb98a3f,          // gold indium-tin-oxide coating
    metalness: 1.0,
    roughness: 0.05,
    transparent: true,
    opacity: 0.28,
    envMapIntensity: 2.0,
    side: THREE.DoubleSide,
    depthWrite: false,        // otherwise it occludes the cockpit interior
  });
}
// always draw after opaque geometry
jet.traverse(o => { if (o.isMesh && o.material?.name === 'Glass_Canopy') o.renderOrder = 10; });
```

### Option B — physical transmission (better looking, more expensive)

```js
function makeCanopyGlass() {
  return new THREE.MeshPhysicalMaterial({
    name: 'Glass_Canopy',
    color: 0xffffff,
    metalness: 0.0,           // must be 0 for transmission to work
    roughness: 0.03,
    transmission: 1.0,
    thickness: 0.02,          // model units (~1 cm real)
    ior: 1.45,                // matches Blender
    attenuationColor: 0xd4af5a,
    attenuationDistance: 0.5,
    iridescence: 1.0,         // gold sheen
    iridescenceIOR: 1.3,
    iridescenceThicknessRange: [100, 400],
    envMapIntensity: 1.5,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
}
```

⚠️ `transmission > 0` makes Three.js render the scene again into a render target every frame — heavy on mobile.
⚠️ **Both options require `scene.environment`.** With no env map the canopy is pure black.

---

## 10. Optimization — 54.76 MB is not shippable

The master export embeds PNGs and weighs **54.76 MB**, but the number that actually kills a game is VRAM:
**one uncompressed 4096×4096 RGBA texture is ~89 MB on the GPU** (mipmaps included), **each**.
The file has 19 of them, mostly 4096² → over 1 GB of VRAM untouched. Mid-range hardware will not survive.

PNG is only compressed on disk; once decoded it uploads raw. **KTX2 is the only format that stays compressed on the GPU.**

Install once:

```bash
npm i -g @gltf-transform/cli
```

### Option A — Simple (one command)

```bash
gltf-transform etc1s F22_master.glb F22_game.glb --quality 200
```

Converts every texture to **ETC1S** (Basis Universal) — roughly 6–8× smaller, transcodes on every platform.
Good for: prototyping, seeing results fast, when normal-map quality isn't critical yet.

Downside: ETC1S visibly **wrecks normal maps** — banding shows up in the shading, because it lossily crushes two channels that need precision.

### Option B — Advanced (codec per map type)

```bash
# 1) prune unused data and downscale first (fast)
gltf-transform prune  F22_master.glb F22_1.glb
gltf-transform dedup  F22_1.glb      F22_2.glb
gltf-transform resize F22_2.glb      F22_3.glb --width 2048 --height 2048

# 2) normals → UASTC
gltf-transform uastc F22_3.glb F22_4.glb \
  --slots "normalTexture" \
  --level 4 --rdo --rdo-lambda 1 --verbose

# 3) everything else → ETC1S
gltf-transform etc1s F22_4.glb F22_5.glb --quality 200 --verbose

# 4) geometry
gltf-transform meshopt F22_5.glb F22_game.glb --level high

rm F22_1.glb F22_2.glb F22_3.glb F22_4.glb F22_5.glb
```

What each step does:

| step | command | effect |
|---|---|---|
| 1 | `prune` | removes unreferenced materials / textures / meshes / nodes (e.g. a stray Height map) |
| | `dedup` | merges byte-identical accessors, textures and materials into single instances |
| | `resize` | downscales every texture to 2048² — **must run before encoding**, since you can't downscale afterwards; cuts VRAM 4× immediately |
| 2 | `uastc --slots normalTexture` | normals use **UASTC** — far higher fidelity than ETC1S, no banding, at ~4× the size. `--rdo` improves gzip compression at almost no quality cost |
| 3 | `etc1s --quality 200` | everything else (base color, ORM, emissive) uses **ETC1S** — smallest, and artifacts in albedo are essentially invisible |
| 4 | `meshopt --level high` | compresses vertex and index buffers (39k tris) and decodes faster than Draco |

Why split them: ETC1S and UASTC are both Basis, but ETC1S optimizes for size and UASTC for accuracy.
**Base color being slightly off is invisible; a normal map being slightly off throws the shading of the whole airframe.**

`--slots` matches glTF slot names: `baseColorTexture`, `normalTexture`, `metallicRoughnessTexture`, `emissiveTexture`, `occlusionTexture`.

### Three.js side

Both options need `KTX2Loader` (plus `MeshoptDecoder` for option B) — see the code in §5.
Copy the Basis transcoder into your public directory:

```bash
cp -r node_modules/three/examples/jsm/libs/basis public/basis
```

### Cut what isn't visible

`Interior_Cockpit_Bays` covers 144 meshes (the entire cockpit and bay interiors). For an exterior-only game, hide the cockpit while the canopy is closed:

```js
const cockpit = [];
jet.traverse(o => { if (o.isMesh && o.name.startsWith('Cockpit_')) cockpit.push(o); });
// in the loop: cockpit.forEach(o => o.visible = M.canopy.progress > 0.01 || cameraIsClose);
```

### Disable frustum culling on bone-driven parts

If pieces pop out of view while the gear folds:

```js
jet.traverse(o => { if (o.isMesh) o.frustumCulled = false; });
```

---

## 11. Main loop

```js
const clock = new THREE.Clock();

function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.05);   // guard against tab-switch spikes

  update(dt);                                     // all mechanisms
  applyControls(input);                           // control surfaces
  applyVector(input.pitch, input.roll * 0.5);     // nozzles
  if (gear.down) spinWheels(groundSpeed, dt);

  renderer.render(scene, camera);
}
animate();
```

---

## 12. Pre-ship checklist

- [ ] `frame_set(1)` before every export (rest pose must be stable)
- [ ] `export_def_bones=False` — forget it and all animation is gone
- [ ] Verify the GLB with the §4.4 script: expect 9 animations and `skinned 0`
- [ ] Never look up bones by name — use `mesh.parent`
- [ ] `subclip` endFrame needs **+1** (exclusive)
- [ ] Hinge control surfaces on the bone's own **local Y** (nozzles: local **X**) — never a world axis
- [ ] Use the union ranges 221–261 / 301–342 for both bay door sides
- [ ] Snap every mechanism to its initial state once loading completes
- [ ] `scene.environment` must exist or glass and metal render black
- [ ] Override the `Glass_Canopy` material and set its `renderOrder`
- [ ] Set `anisotropy` on textures (GLTFLoader doesn't)
- [ ] **Never ship `F22_master.glb`** — run §10 to produce `F22_game.glb`
- [ ] Wire up `KTX2Loader` and copy `basis/` into public
- [ ] *(manual-texture path only)* `flipY = false` everywhere, `metalness/roughness = 1.0` wherever a map is assigned

---

## Appendix — project files

| file | what it is |
|---|---|
| `F22.blend` | main working file (textures + rig + showcase) |
| `F22 no textures.blend` | pre-texturing version |
| `F22_backup_before_rename_*.blend` | backup taken before the rename pass |
| `F22_rename_map.json` | 278 old → new name mappings |
| `F22_revert_rename.py` | script to undo the rename |
| `source/Lockheed Martin F-22.fbx` | original source asset |
| `textures/` | 28 PNG files (~85 MB) |
