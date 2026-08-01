# F-22 Raptor — glTF → Three.js Integration Guide

คู่มือสำหรับเอา `F22.blend` ออกเป็น glTF/GLB แล้วคุม animation + texture เองใน Three.js

ทุกตัวเลขในเอกสารนี้อ่านมาจากไฟล์จริง (`F22.blend`, Blender 5.2.0 LTS) และจากการ **ทดลอง export จริง** แล้วแกะ GLB ดู ไม่ใช่ค่าที่เดา

---

## 1. Model overview

| item | value |
|---|---|
| ไฟล์หลัก | `F22.blend` |
| Blender | 5.2.0 LTS |
| Objects | 277 (mesh 265) |
| Triangles | ~39,040 |
| Materials | 7 |
| Armatures (rig) | 9 |
| Scene FPS | **24** |
| Timeline | frame 1 – 972 (40.5 s) |
| Unit scale | 1.0 |
| Bounding box | X 4.29 × Y 3.10 × Z 1.06 (Blender units) |
| Textures | 28 PNG, รวม ~85 MB (`textures/`) |
| GLB (ฝัง texture) | 54.76 MB, 19 image |
| GLB (ไม่ฝัง texture) | 3.46 MB |

**สเกล:** ลำจริงยาว 18.92 m แต่โมเดลยาว 4.29 units → คูณ **4.41** ถ้าอยากได้หน่วยเมตร
(หรือปล่อยไว้แล้วปรับ camera/physics ตามสเกลโมเดลก็ได้ — แค่ต้องเลือกอย่างเดียวแล้วอยู่กับมัน)

**แกน:** Blender Z-up → glTF/Three.js Y-up แปลงเป็น `(x, y, z)_blender → (x, z, -y)_three`

| ทิศ | Blender | Three.js |
|---|---|---|
| จมูกเครื่อง (nose) | +X | **+X** |
| ปีกขวา | −Y | **+Z** |
| ปีกซ้าย | +Y | −Z |
| บน | +Z | **+Y** |

ดังนั้นใน Three.js: **roll = แกน X, yaw = แกน Y, pitch = แกน Z**

### 1.1 ชื่อ object

ทุกชิ้นถูก rename เป็นระบบแล้ว (จากชื่อเดิม `Fuselage.047`, `bLGrack.L.023` ฯลฯ)
แผนที่ชื่อเก่า→ใหม่ทั้ง 278 รายการอยู่ใน `F22_rename_map.json`, script ย้อนกลับอยู่ใน `F22_revert_rename.py`

Prefix ที่ใช้:

| prefix | ความหมาย | จำนวนคร่าวๆ |
|---|---|---|
| `Body_`, `Wing_`, `Tail_` | โครงสร้าง + control surface | 15 |
| `MLG_*` | main landing gear ซ้าย/ขวา | 56 |
| `NLG_*` | nose landing gear | 17 |
| `Bay_*` | weapon bay + ประตู + ราง | 45 |
| `Canopy_*` | ฝาครอบห้องนักบิน | 5 |
| `Cockpit_*`, `Seat_*` | ภายใน | 90 |
| `Engine_Nozzle_*` | ท่อท้าย (thrust vectoring) | 9 |
| `Hook_*` | tailhook | 7 |
| `Wpn_*` | AIM-120 ×6, AIM-9M ×2 | 8 |
| `Light_*` | ไฟ taxi / formation | 5 |
| `RIG_*` | armature (ไม่มี mesh) | 9 |

---

## 2. สถาปัตยกรรม rig — อ่านตรงนี้ก่อนเขียนโค้ด

**หัวใจ: คุม "กลไก" ไม่ใช่คุม "ชิ้นส่วน"**

ขาหลังข้างซ้ายมี 28 ชิ้น (strut, drag brace, torque link บน/ล่าง, door link 3 ตัว, actuator rod, brake disc, ล้อ...) แต่**คุณไม่ต้องแตะสักชิ้นเดียว** — ทุกชิ้น parent อยู่กับ bone ของ `RIG_MainGear_L` และ bone ทุกตัวถูก key ไว้แล้ว เล่น clip เดียวจบ กลไก linkage วิ่งตามเองหมด

รายชื่อชิ้นส่วนในตารางข้างล่างมีไว้ **อ้างอิง** (เผื่ออยากซ่อน/เปลี่ยน material/ยิง raycast) ไม่ใช่สิ่งที่ต้อง animate เอง

### 2.1 ข้อเท็จจริงสำคัญจากการ export ทดสอบ

1. **ได้ 9 AnimationClip** ชื่อตรงกับ armature: `RIG_NoseGear`, `RIG_MainGear_L`, `RIG_MainGear_R`, `RIG_BayDoor_Center_L/R`, `RIG_BayDoor_Side_L/R`, `RIG_Canopy`, `RIG_Tail_Nozzle_Hook`
   (ถึงจะตั้ง export mode = `SCENE` ก็ยังแยกเป็น 9 clip เพราะ exporter แยกตาม armature)
2. ทุก clip กินช่วง **0.042 – 40.5 s** เท่ากันหมด (= frame 1–972) แต่ **แต่ละ clip มี track เฉพาะ bone ของ rig ตัวเอง**
3. **skinned mesh = 0** — mesh ทุกชิ้นเป็น node ธรรมดาที่เป็นลูกของ bone node ⇒ เขียน transform ใส่ node ตรงๆ ได้ (หมุนล้อ, ขยับ control surface) ไม่ต้องยุ่งกับ skinning
4. `track time = frame / 24` เป๊ะๆ → frame 1 = 0.04167 s, frame 972 = 40.5 s

### 2.2 rig → bone → mesh

`RIG_Tail_Nozzle_Hook` (23 bones) — rig รวมมิตร คุมทั้ง tailhook + control surface + nozzle

| bone | ชิ้นที่ติดอยู่ | หมวด |
|---|---|---|
| `Bone` | `Hook_Pivot` | tailhook |
| `Bone.003` | `Hook_Trunnion` | tailhook |
| `Bone.022` | `Hook_Shank_Upper`, `Hook_Shank_Arm`, `Hook_Point`, `Hook_Actuator` | tailhook (ไม่มี key — ห้อยตาม parent) |
| `Bone.001` / `Bone.002` | `Tail_InterNozzle_Panel_L` / `_R` | แผ่นระหว่างท่อท้าย — **ขยับพร้อม hook** |
| `Bone.004` / `Bone.005` | `Tail_Stabilator_R` / `_L` | pitch |
| `Bone.006` / `Bone.007` | `Tail_VerticalFin_R` / `_L` | rudder (yaw) |
| `Bone.008` / `Bone.009` | `Wing_Flaperon_R` / `_L` | pitch+roll |
| `Bone.010` / `Bone.011` | `Wing_LEFlap_R` / `_L` | leading-edge flap |
| `Bone.012` / `Bone.013` | `Wing_Aileron_R` / `_L` | roll |
| `Bone.014` `.016` | nozzle flap บน R / L | thrust vectoring |
| `Bone.018` `.020` | nozzle flap ล่าง R / L | thrust vectoring |
| `Bone.015` `.017` | nozzle vane บน R / L | |
| `Bone.019` `.021` | nozzle vane ล่าง R / L | |

`RIG_MainGear_L` / `_R` (23 bones/ข้าง) — ชิ้นสำคัญ

| bone | ชิ้น |
|---|---|
| `Bone.008` | `MLG_x_Strut_Main` (+ Detail_01/05) |
| `Bone.014` | `MLG_Wheel_x`, `MLG_x_BrakeDisc`, `MLG_x_AxleFork` |
| `Bone.019` | `MLG_x_Door`, `MLG_x_DoorActuator`, `MLG_x_DoorLink_02` |
| `Bone` | `MLG_x_DragBrace`, `MLG_x_UpperLink` |
| `Bone.011` / `.012` | `MLG_x_TorqueLink_Upper` / `_Lower` |
| `Bone.006` | `MLG_x_Trunnion` |
| `Bone.010` | `MLG_x_SideBrace` |
| `Bone.009` | `MLG_x_BayFairing` |
| ที่เหลือ | `MLG_x_Detail_01..10`, `DoorLink_01/03`, `Pin_01`, `ActuatorRod`, `ShockCollar`, `UpperFitting` |

`RIG_NoseGear` (12 bones)

| bone | ชิ้น |
|---|---|
| `Bone.005` | `NLG_Strut_Outer`, **`Light_Taxi_L`, `Light_Taxi_R`** (ไฟ taxi ติดที่ขาหน้า) |
| `Bone.002` | `NLG_Strut_Inner`, `NLG_Wheel` |
| `Bone.009` | `NLG_Pivot_Pin`, `NLG_TorqueLink` |
| `Bone.003` | `NLG_LockLink_Upper/Mid/Lower` |
| `Bone.001` | `NLG_RetractActuator` |
| `Bone` | `NLG_DragBrace` |
| `Bone.007` / `.008` | ประตูขาหน้าฝั่ง R / L (`NLG_Door_Rail_x` + hinge pin ×3) |
| `Control` | control bone |

`RIG_BayDoor_Center_L` / `_R` — **คุมทั้งประตู center bay และ side bay ฝั่งเดียวกัน**

| bone | ชิ้น |
|---|---|
| `Bone.002` | `Bay_Center_Door_x` + frame + hinge rod |
| `Bone.003` | ขอบ/ซีล center door |
| `Bone.009` `.010` `.011` `.004` | hinge arm, rib ใน, rib นอก, ซีลหน้า |
| `Bone` | `Bay_Side_Door_x_Inner` + frame ล่าง |
| `Bone.001` | `Bay_Side_Door_x_Outer` + frame บน |
| `Bone.008` | side door hinge arm/pin |

`RIG_BayDoor_Side_L` / `_R` — แขนกาง AIM-9 (trapeze)

| bone | ชิ้น |
|---|---|
| `Bone.007` | `Bay_Side_LauncherRail_x`, **`Wpn_AIM9M_x`** |
| `Bone.005` / `.006` | `Bay_Side_LauncherArm_x_Aft` / `_Fwd` |

`RIG_Canopy`

| bone | ชิ้น |
|---|---|
| `Bone` | `Canopy_Glass`, `Canopy_Frame_Rear`, `Canopy_Actuator` |
| `Bone.001` | `Canopy_Hinge_Arm` |
| `Bone.002` | `Canopy_Hinge_Bracket` |

---

## 3. Timeline (Animation showcase)

action เดียวชื่อ `Scene` ในไฟล์ blend เก็บ showcase ทั้งหมดเรียงต่อกัน ตัดเป็นท่อนตามตารางนี้

`t = frame / 24`

| # | ท่า | frames | seconds | clip |
|---|---|---|---|---|
| 1 | **Canopy ปิด** | 8 – 70 | 0.333 – 2.917 | `RIG_Canopy` |
| 2 | **Main gear ขึ้น** | 111 – 181 | 4.625 – 7.542 | `RIG_MainGear_L`, `_R` |
| 3 | **Tailhook เก็บ** | 116 – 188 | 4.833 – 7.833 | `RIG_Tail_Nozzle_Hook` |
| 4 | **Nose gear ขึ้น** | 172 – 214 | 7.167 – 8.917 | `RIG_NoseGear` |
| 5 | **Weapon bay เปิด** | 221 – 261 | 9.208 – 10.875 | `RIG_BayDoor_Center_L/R` |
| 5b | ↳ แขน AIM-9 กาง | 236 – 249 | 9.833 – 10.375 | `RIG_BayDoor_Side_L/R` |
| 6 | **Weapon bay ปิด** | 301 – 342 | 12.542 – 14.250 | `RIG_BayDoor_Center_L/R` |
| 6b | ↳ แขน AIM-9 หุบ | 313 – 326 | 13.042 – 13.583 | `RIG_BayDoor_Side_L/R` |
| 7 | **Aero demo** (control surface + thrust vectoring) | 345 – 734 | 14.375 – 30.583 | `RIG_Tail_Nozzle_Hook` |
| 8 | **Nose gear ลง** | 741 – 781 | 30.875 – 32.542 | `RIG_NoseGear` |
| 9 | **Tailhook กาง** | 764 – 840 | 31.833 – 35.000 | `RIG_Tail_Nozzle_Hook` |
| 10 | **Main gear ลง** | 771 – 841 | 32.125 – 35.042 | `RIG_MainGear_L`, `_R` |
| 11 | **Canopy เปิด** | 842 – 907 | 35.083 – 37.792 | `RIG_Canopy` |

⚠️ **ประตู bay ซ้าย/ขวาไม่ตรงกันเป๊ะ** — Center_L = 221–257, Center_R = 221–261, ตอนปิด Center_R = 301–342, Center_L = 305–342
ถ้าตัด clip แยกข้างตามเลขของตัวเอง จะได้ประตูข้างหนึ่งค้างแง้ม **ใช้ช่วง union 221–261 / 301–342 กับทั้งสองข้าง**

รายละเอียดท่อน Aero demo (7) แยกย่อย:

| ช่วง frame | ทำอะไร |
|---|---|
| 345 – 499 | rudder (`Tail_VerticalFin_L/R`) แกว่ง |
| 351 – 530 | LE flap + flaperon รอบแรก |
| 381 – 541 | stabilator pitch |
| 381 – 700 | nozzle flap บน/ล่าง — pitch vectoring แล้วต่อด้วย differential (ซ้าย/ขวาสวนทาง) |
| 542 – 700 | aileron roll |
| 560 – 734 | LE flap + flaperon รอบสอง |

ค่าที่วัดได้: nozzle เบนสูงสุด **+16° / −20°** (pitch), ช่วง 542+ ซ้ายขวาเบนสวนทางกัน (roll vectoring)

**สถานะที่ frame 1:** canopy เปิด (−20°), gear ลง, hook กาง, bay ปิด — ไม่มี frame ไหนที่ "gear ลง + hook เก็บ" พร้อมกัน ดังนั้นอย่าหวังพึ่ง rest pose จาก glTF ให้ set state เองตอนโหลด (ดูข้อ 6.3)

---

## 4. Export จาก Blender

### 4.1 สูตรที่ทดสอบแล้วใช้ได้ (แนะนำ — ฝัง texture ไปเลย)

รันใน Blender Scripting tab (หรือผ่าน MCP):

```python
import bpy, os

OUT = "/path/to/your/game/public/models"
os.makedirs(OUT, exist_ok=True)

bpy.context.scene.frame_set(1)          # pin rest pose ให้ export ซ้ำได้ผลเดิม

bpy.ops.export_scene.gltf(
    filepath=os.path.join(OUT, "F22_master.glb"),
    export_format='GLB',
    export_image_format='AUTO',          # ฝัง texture ลงไฟล์เลย
    export_animations=True,
    export_animation_mode='SCENE',
    export_frame_range=True,
    export_bake_animation=False,
    export_def_bones=False,              # ⚠️ ต้อง False ไม่งั้น bone ที่ไม่ deform หายหมด
    export_apply=False,
    use_selection=False,
    export_cameras=False,
    export_lights=False,
    export_yup=True,
)
```

ผลที่ได้จริง: **54.76 MB**, 265 mesh, 385 node, 7 material, **19 image**, 9 animation, 0 skinned mesh (ใช้เวลา ~13 วิ)

ไฟล์นี้คือ **master** ยังไม่ได้ optimize — ห้ามส่งเข้าเกมตรงๆ ให้ผ่านข้อ 10 ก่อน

### 4.2 exporter จัดการ texture ให้อัตโนมัติ

PNG 26 ใบใน `textures/` ถูกยุบเหลือ **19 image** เพราะ exporter แพ็กให้เอง:

| exporter ทำอะไร | ผลลัพธ์ |
|---|---|
| **แพ็ก Metallic + Roughness เป็นใบเดียว** (ORM: G=roughness, B=metallic) | `Cabin_Metallic-Cabin_Roughness`, `Landing_gear_Metallic-Landing_gear_Roughness`, ... |
| **ยัด Opacity เข้า alpha channel ของ base color** | `Cabin_Base_color-Cabin_Opacity`, `Landing_gear_Base_color-Landing_gear_Opacity` |
| ตั้ง `alphaMode: MASK` ให้ material ที่มี opacity | `Interior_Cockpit_Bays`, `LandingGear` (cutoff default 0.5) |
| ทิ้ง `Cockpit_+_details_Height.png` | ไม่ได้ต่อใน node tree |

`Airframe_Exterior` ไม่มีไฟล์ roughness → exporter ใส่ metallic ไว้ช่อง B แล้วปล่อยช่อง G เป็นขาว 255 พร้อมตั้ง `roughnessFactor: 0.5` ⇒ ได้ roughness คงที่ 0.5 ทั้งลำ ถูกต้องตามที่ตั้งใน Blender

**แปลว่าโหลดเข้า Three.js แล้ว material พร้อมใช้ทันที** ไม่ต้องเขียนโค้ดผูก texture เอง (ยกเว้นกระจก ดูข้อ 9)

### 4.3 ทางเลือก — export แบบไม่ฝัง texture

ถ้าอยากคุม texture เองทุกใบ (สลับความละเอียดตามเครื่อง, สตรีมทีหลัง, เปลี่ยน livery) ใช้:

```python
export_image_format='NONE',
```

ได้ **3.46 MB** — material ยังมีครบ 7 ตัวพร้อมชื่อ แค่ไม่มี map ผูกอยู่ แล้วไปผูกเองตามข้อ 8

### 4.4 ตรวจไฟล์ที่ export แล้ว

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

ต้องเห็น 9 บรรทัด animation และ `skinned 0`

### 4.5 ⚠️ ชื่อ node หลังโหลดเข้า Three.js เปลี่ยน

`GLTFLoader` ทำ 2 อย่างกับชื่อ:
1. ลบอักขระสงวน `. [ ] : /` → `Bone.009` กลายเป็น **`Bone009`**
2. ชื่อซ้ำจะเติม suffix → armature ทั้ง 9 ตัวมี `Bone`, `Bone.001` เหมือนกัน ⇒ กลายเป็น `Bone`, `Bone_1`, `Bone_2`, ... **เดาไม่ได้**

**อย่าหา bone ด้วยชื่อ** ให้หา mesh (ชื่อ unique 100%) แล้วเอา `.parent`:

```js
const boneOf = (name) => scene.getObjectByName(name).parent;
const flapL  = boneOf('Wing_Flaperon_L');   // = Bone.009 ของ RIG_Tail_Nozzle_Hook
```

---

## 5. โหลดและ setup ใน Three.js

```js
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;

// environment map จำเป็นมาก — ไม่มีแล้วผิวโลหะกับกระจกจะดำ
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

const gltf = await new GLTFLoader().loadAsync('/models/F22_game.glb');
const jet = gltf.scene;
scene.add(jet);

const clips = Object.fromEntries(gltf.animations.map(c => [c.name, c]));
// clips['RIG_MainGear_L'], clips['RIG_Canopy'], ...
```

ถ้า export แบบฝัง texture (ข้อ 4.1) **material มาครบพร้อมใช้แล้ว** เหลือแค่ปรับ 3 อย่าง:

```js
jet.traverse((o) => {
  if (!o.isMesh) return;
  const m = o.material;

  // 1. anisotropy — GLTFLoader ไม่ตั้งให้ ผิวลำตัวมองเฉียงจะเบลอ
  for (const k of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'emissiveMap'])
    if (m[k]) m[k].anisotropy = renderer.capabilities.getMaxAnisotropy();

  // 2. จอ MFD ในค็อกพิตให้สว่างขึ้น
  if (m.name === 'Interior_Cockpit_Bays') m.emissiveIntensity = 1.2;

  // 3. กระจก canopy — ต้อง override เสมอ (ดูข้อ 9)
  if (m.name === 'Glass_Canopy') o.material = makeCanopyGlass(), o.renderOrder = 10;
});
```

ถ้าโหลด KTX2 (ข้อ 10) ต้องต่อ loader ก่อน:

```js
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

const ktx2 = new KTX2Loader().setTranscoderPath('/basis/').detectSupport(renderer);
const loaderGLB = new GLTFLoader().setKTX2Loader(ktx2).setMeshoptDecoder(MeshoptDecoder);
```

---

## 6. คุม animation

### 6.1 หลักการ

- **1 armature = 1 `AnimationMixer`** โดยใช้ node ของ armature เป็น root
  → ผูก track ได้ถูกตัวแน่นอน ไม่สับสนกับชื่อ bone ที่ซ้ำกันข้าม rig
- ไม่ปล่อยให้ clip เล่นเอง แต่ **scrub** ด้วยการเขียน `action.time` แล้วเรียก `mixer.update(0)`
  → ได้ค่า progress 0..1 ที่กด toggle กลางทางแล้วย้อนกลับได้ทันที (เหมาะกับ gear/canopy ในเกม)
- `AnimationUtils.subclip()` **ตัด track ที่ไม่มี key ในช่วงนั้นทิ้ง** → subclip ของ tailhook (frame 116–188) จะมีแค่ `Bone`, `Bone.001`, `Bone.002`, `Bone.003` ส่วน bone ปีก/nozzle หลุดออกไปหมด **แปลว่า mixer จะไม่ไปแย่งเขียนค่ากับโค้ด control surface ที่เราคุมเอง** — นี่คือเหตุผลที่ออกแบบแบบนี้แล้วปลอดภัย

### 6.2 Mechanism class

```js
const FPS = 24;

class Mechanism {
  /**
   * @param rigRoot  Object3D ของ armature (เช่น scene.getObjectByName('RIG_MainGear_L'))
   * @param clip     AnimationClip
   * @param range    [startFrame, endFrame] ตาม Blender — ใส่ null = ใช้ทั้ง clip
   * @param seconds  เวลาเปิด/ปิดจริงในเกม (วินาที)
   */
  constructor(rigRoot, clip, range = null, seconds = null) {
    this.mixer = new THREE.AnimationMixer(rigRoot);

    this.clip = range
      // +1 เพราะ subclip ตัดแบบ endFrame เป็น exclusive (frame >= endFrame จะถูกทิ้ง)
      ? THREE.AnimationUtils.subclip(clip.clone(), `${clip.name}_sub`, range[0], range[1] + 1, FPS)
      : clip;

    this.action = this.mixer.clipAction(this.clip);
    this.action.loop = THREE.LoopOnce;
    this.action.clampWhenFinished = true;
    this.action.play();            // ห้าม pause — เราคุมเวลาเองด้วย update(0)

    this.duration = this.clip.duration;
    this.rate = 1 / (seconds ?? this.duration);   // progress ต่อวินาที
    this.t = 0;
    this.target = 0;
    this.#apply();
  }

  #apply() {
    this.action.time = Math.min(this.t * this.duration, this.duration - 1e-4);
    this.mixer.update(0);          // delta 0 = ไม่เดินเวลาเอง แค่ apply pose
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

> ถ้าจะใช้ `mixer.setTime(t)` แทน `action.time + update(0)` ได้เหมือนกัน **แต่ห้ามตั้ง `action.paused = true`** — action ที่ paused มี effective timeScale = 0 ทำให้ `setTime` ไม่ขยับอะไรเลย

### 6.3 ประกอบเป็นระบบทั้งลำ

```js
const rig  = (n) => jet.getObjectByName(n);
const F    = (a, b) => [a, b];

const M = {
  // clip ของ rig พวกนี้มีแค่กลไกตัวเอง — ตัด subclip ก็ได้ ไม่ตัดก็ได้
  canopy:    new Mechanism(rig('RIG_Canopy'),          clips['RIG_Canopy'],          F(842, 907), 2.5),
  noseGear:  new Mechanism(rig('RIG_NoseGear'),        clips['RIG_NoseGear'],        F(741, 781), 2.0),
  mainGearL: new Mechanism(rig('RIG_MainGear_L'),      clips['RIG_MainGear_L'],      F(771, 841), 3.0),
  mainGearR: new Mechanism(rig('RIG_MainGear_R'),      clips['RIG_MainGear_R'],      F(771, 841), 3.0),

  bayL:      new Mechanism(rig('RIG_BayDoor_Center_L'), clips['RIG_BayDoor_Center_L'], F(221, 261), 1.6),
  bayR:      new Mechanism(rig('RIG_BayDoor_Center_R'), clips['RIG_BayDoor_Center_R'], F(221, 261), 1.6),
  railL:     new Mechanism(rig('RIG_BayDoor_Side_L'),   clips['RIG_BayDoor_Side_L'],   F(236, 249), 0.6),
  railR:     new Mechanism(rig('RIG_BayDoor_Side_R'),   clips['RIG_BayDoor_Side_R'],   F(236, 249), 0.6),

  // rig ท้ายเครื่องรวม hook + ปีก + nozzle → ต้อง subclip เอาเฉพาะ hook
  hook:      new Mechanism(rig('RIG_Tail_Nozzle_Hook'), clips['RIG_Tail_Nozzle_Hook'], F(764, 840), 1.8),
};

// state เริ่มต้น: gear ลง, canopy ปิด, hook เก็บ, bay ปิด
M.noseGear.snap(1); M.mainGearL.snap(1); M.mainGearR.snap(1);
M.canopy.snap(0); M.hook.snap(0);
M.bayL.snap(0); M.bayR.snap(0); M.railL.snap(0); M.railR.snap(0);

// API ระดับเกม
const gear = {
  set(down) { M.noseGear.set(down ? 1 : 0); M.mainGearL.set(down ? 1 : 0); M.mainGearR.set(down ? 1 : 0); },
  get down() { return M.mainGearL.progress > 0.99; },
  get moving() { return M.noseGear.moving || M.mainGearL.moving || M.mainGearR.moving; },
};
const bay = {
  set(open) { for (const k of ['bayL','bayR','railL','railR']) M[k].set(open ? 1 : 0); },
};

function update(dt) { for (const m of Object.values(M)) m.update(dt); }
```

**หมายเหตุทิศทางเวลา:** ใน showcase ต้นฉบับ frame 771→841 คือ **gear ลง** ดังนั้น `progress 1 = gear down` ถ้าอยากให้ `1 = up` ใช้ช่วงขาเก็บ (111–181) แทน แล้วสลับความหมายเอง

**คีย์บอร์ด:**

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

## 7. ชิ้นส่วนที่ต้องคุมเอง (ไม่ใช้ clip)

### 7.1 Control surface — ขับด้วย input ไม่ใช่เล่น clip

ท่อน aero demo (frame 345–734) เอาไว้ดูสวยๆ เฉยๆ **ในเกมอย่าเล่นมัน** ให้เขียนมุมลง bone ตรงๆ ตามค่า pitch/roll/yaw

bone พวกนี้อยู่ใน rig เดียวกับ hook แต่ subclip ของ hook ไม่มี track ของมัน ⇒ เขียนทับได้ปลอดภัย
⚠️ จริงเฉพาะ export แบบแยก armature ถ้าโหลดไฟล์ที่รวมเป็น **clip `Scene` ตัวเดียว** clip นั้น key bone พวกนี้ด้วย มันจะแย่งเขียนทุกเฟรม — ต้องหยุด mixer (หรือ subclip เฉพาะช่วงที่ต้องการ) ก่อนเขียนมุมเอง

#### แกนบานพับคือแกนของ bone เอง ไม่ใช่แกน world

🔴 **จุดที่พลาดกันทุกคน** ถ้าหมุนรอบแกน world ตรงๆ stabilator จะดูโอเค แต่ชิ้นอื่นผิดหมด เพราะแนวบานพับจริงไม่ได้ขนานแกนไหนเลย

แกะคลิป showcase ออกมาดู ทุก keyframe ของ bone ทั้งสิบตัวเป็น **การหมุนรอบแกน local Y ล้วนๆ** ไม่มีข้อยกเว้น ไม่มีองค์ประกอบนอกแกน เพราะ local Y มีเรขาคณิตจริงฝังอยู่แล้ว:

| ชิ้น | local Y ใน body frame | คลาดแค่ไหนถ้าใช้ world `(0,0,1)` / `(0,1,0)` |
|---|---|---|
| `Tail_Stabilator_L/R` | `(0, 0, ∓1)` | 0° — ตัวเดียวที่บังเอิญถูก |
| `Wing_Flaperon_L/R` | `(0.260, 0, ∓0.965)` | **15°** — ขอบท้ายปีกกวาด |
| `Wing_Aileron_L/R` | `(0.269, −0.042, ∓0.962)` | **15°** |
| `Wing_LEFlap_L/R` | `(−0.668, −0.027, ∓0.744)` | **42°** — ขอบหน้าปีกกวาด |
| `Tail_VerticalFin_L/R` | `(0.335, 0.816, ∓0.471)` | **28°** — มุม cant ที่เอียงออก |

bone ของ nozzle ก็เรื่องเดียวกัน แค่เปลี่ยนตัวอักษร — มันหมุนรอบ **local X**

แกนซ้าย/ขวาเป็น mirror กัน เลยต้องพลิกเทียบทิศอ้างอิงร่วม เพื่อให้มุมบวกมีความหมายเดียวกันทั้งสองข้าง

```js
// helper: สร้างบานพับรอบแกนของ bone เอง โดยเก็บ rest pose ไว้
// สร้างตอนโหลด ก่อนที่จะไปหมุน attitude ของเครื่องบิน
function makeHinge(meshName, hingeAxis, reference) {
  const mesh = jet.getObjectByName(meshName);
  const bone = mesh.parent;                        // bone node
  const rest = bone.quaternion.clone();
  const q = new THREE.Quaternion();

  const axis = hingeAxis.clone();
  const world = axis.clone().applyQuaternion(bone.getWorldQuaternion(new THREE.Quaternion()));
  if (world.dot(reference) < 0) axis.negate();     // ให้สองข้างชี้ทางเดียวกัน

  return (deg) => bone.quaternion.copy(rest).multiply(q.setFromAxisAngle(axis, deg * Math.PI / 180));
}

const SPAR   = new THREE.Vector3(0, 1, 0);   // control surface หมุนรอบ local Y ของ bone
const NOZZLE = new THREE.Vector3(1, 0, 0);   // flap/vane ของ nozzle หมุนรอบ local X

const STARBOARD = new THREE.Vector3(0, 0,  1);
const UP        = new THREE.Vector3(0, 1,  0);
const PORT      = new THREE.Vector3(0, 0, -1);

const surf = {
  stabL:  makeHinge('Tail_Stabilator_L',  SPAR, STARBOARD),
  stabR:  makeHinge('Tail_Stabilator_R',  SPAR, STARBOARD),
  flapL:  makeHinge('Wing_Flaperon_L',    SPAR, STARBOARD),
  flapR:  makeHinge('Wing_Flaperon_R',    SPAR, STARBOARD),
  ailL:   makeHinge('Wing_Aileron_L',     SPAR, STARBOARD),
  ailR:   makeHinge('Wing_Aileron_R',     SPAR, STARBOARD),
  leL:    makeHinge('Wing_LEFlap_L',      SPAR, STARBOARD),
  leR:    makeHinge('Wing_LEFlap_R',      SPAR, STARBOARD),
  rudL:   makeHinge('Tail_VerticalFin_L', SPAR, UP),
  rudR:   makeHinge('Tail_VerticalFin_R', SPAR, UP),
};
```

**พอ normalize แบบนี้ มุมบวกแปลว่า:** ขอบท้ายกด **ลง** สำหรับชิ้นแนวนอน, ขอบหน้ายก **ขึ้น** สำหรับ LE flap, ขอบท้ายเบนไปทาง **กราบขวา** สำหรับหางตั้ง

#### ลิมิตองศา — วัดมาแล้ว

อย่าเดาเลข พวกนี้คือค่าสูงสุดที่ key ไว้ใน showcase ต้อง clamp ด้วย ไม่งั้นคำสั่ง pitch + roll + flaps รวมกันจะดันใบทะลุปีก

| ชิ้น | ลิมิต |
|---|---|
| stabilator | ±20° |
| flaperon | ±22.6° |
| aileron | ±25° |
| LE flap | ±11.4° |
| หางตั้ง | ±22.6° |

#### การผสมสัญญาณ

```js
const clamp = THREE.MathUtils.clamp;

// pitch/roll/yaw = -1..1
function applyControls({ pitch, roll, yaw, flaps = 0 }) {
  // เชิดหัวขึ้น = ต้องกดหางลง ⇒ stabilator (และ flaperon ที่ทำหน้าที่ elevon) ขอบท้าย
  // ยกขึ้น / ม้วนขวา = ต้องได้ lift ปีกซ้ายมากกว่า ⇒ ใบฝั่งซ้ายขอบท้ายกดลง /
  // yaw ใช้หางตั้งทั้งสองข้างเบนทางเดียวกัน / LE flap ห้อยลงตาม flaps จึงติดลบ
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

> **เช็คได้ ไม่ต้องเดา** เอา vertex ท้ายสุดของแต่ละใบมาดูว่าขยับไปทางไหน: pitch up ⇒ stabilator ขอบท้ายขึ้นทั้งคู่ / roll right ⇒ ซ้ายขอบท้ายลง ขวาขอบท้ายขึ้น / yaw right ⇒ หางตั้ง **ทั้งสองข้าง** เบนไปกราบขวา / flaps ⇒ flaperon ลง + LE flap ห้อย
> ตอน yaw ขอบท้ายหางซ้ายจะยกขึ้นส่วนขวาจะกดลง **ไม่ใช่บั๊ก** — เป็นพฤติกรรมของหางตั้งที่ cant 28° เวลาหมุนรอบสปาร์ตัวเอง

### 7.2 Thrust vectoring nozzle

8 ชิ้น (flap บน/ล่าง + vane บน/ล่าง × ซ้าย/ขวา) หมุนรอบ **local X ของ bone** ไม่ใช่แกนปีก

normalize เทียบ `PORT` แล้วมุมบวกแปลว่าขอบท้ายยก **ขึ้น** ทั้ง 8 ชิ้น = เบนไอพ่นขึ้น → กดหางลง → หัวเชิดขึ้น

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

// เครื่องยนต์หนึ่งตัว v = -1..1 บวก = เบนไอพ่นขึ้น
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

เลข 20 / 8 / 10 มาจาก showcase เอง อ่านจาก frame 381–700 และ **mirror กันเป๊ะ** ระหว่างช่วงเบนขึ้นกับเบนลง:

| frame | flap บน | flap ล่าง | vane บน | vane ล่าง |
|---|---|---|---|---|
| 420 (เบนขึ้น) | +20° | +8° | +10° | 0° |
| 500 (เบนลง) | −8° | −20° | 0° | −10° |

(เป็นองศาที่ key ไว้ วัดรอบ local X ของแต่ละ bone สังเกตว่า vane ขยับ *สวนทาง* กับ flap ฝั่งเดียวกันเสมอ — มันหุบเข้าเวลา flap กางออก)

ตั้งแต่ frame 542 เครื่องซ้ายกับขวาเบนสวนกันด้วยขนาดเท่ากัน — นั่นคือ roll vectoring และเป็นสิ่งที่ `diff` จำลองพอดี ม้วนขวาต้องให้เครื่อง **ซ้าย** เบนไอพ่นลงเพื่อยกปีกข้างนั้น จึงเป็น `vec - diff` ที่ฝั่งซ้าย

### 7.3 ล้อหมุน — ต้องหาแกนเอง

ล้อเป็น mesh node ธรรมดาใต้ bone หมุนได้ตรงๆ แต่ **แกน local ของมันเดาไม่ได้** (rest transform ใน bone space เปลี่ยนไปตอน export) ให้หาแกนจาก world basis:

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

// ในลูป: omega = speed / radius
const RADIUS_MAIN = 0.11, RADIUS_NOSE = 0.066;   // Blender units
function spinWheels(speed, dt) {
  spinL(speed / RADIUS_MAIN * dt);
  spinR(speed / RADIUS_MAIN * dt);
  spinNose(speed / RADIUS_NOSE * dt);
}
```

**ถ้าล้อหมุนผิดระนาบ** ลองไล่ `(1,0,0)` → `(0,1,0)` → `(0,0,1)` เอาอันที่ดูถูก (ใช้เวลา 30 วินาที เร็วกว่านั่งคำนวณ)

⚠️ อย่าหมุนล้อขณะที่ gear clip กำลังเล่น — clip เขียน bone (parent) ส่วนเราเขียน mesh (child) ไม่ชนกันก็จริง แต่การหมุนสะสมจะดูแปลกตอนขาพับ ให้หมุนเฉพาะตอน `gear.down === true`

---

## 8. Textures (Optional — เฉพาะกรณีโหลดเอง)

> **ถ้า export แบบฝัง texture (ข้อ 4.1) ข้ามหัวข้อนี้ได้ทั้งหมด** — GLTFLoader ผูก map, colorSpace, flipY, alphaMode ให้ถูกต้องอยู่แล้ว
>
> อ่านต่อเมื่อ export ด้วย `export_image_format='NONE'` (ข้อ 4.3) เพราะอยาก:
> - สลับความละเอียด texture ตามสเปกเครื่อง
> - สตรีม texture ทีหลัง (โหลดโมเดล 3.5 MB ขึ้นก่อน แล้วค่อยเติม)
> - เปลี่ยน livery / skin ระหว่างเกม
> - ใช้ ORM ที่แพ็กเอง หรือ texture atlas ของตัวเอง

### 8.0 ข้อมูลไฟล์จริง

ทุกไฟล์เป็น **PNG ไม่มี alpha channel** (RGB หรือ grayscale ล้วน) — ไม่ต้องเสียเวลาไล่ตัด alpha

| ชนิด map | bit depth | ขนาด |
|---|---|---|
| Base color, Emissive | 8-bit RGB | 4096² (Weapons 1024²) |
| Metallic, Roughness, Opacity | 8-bit grayscale | 4096² |
| **Normal** | **16-bit RGB** | 4096² |
| Height (ไม่ได้ใช้) | 16-bit grayscale | 4096² |

⚠️ Normal เป็น 16-bit ทำให้ไฟล์ใหญ่เท่าตัว แต่ block format บน GPU เป็น 8-bit หมด → แปลงเป็น 8-bit ก่อน encode

ความโปร่งใสอยู่ใน **opacity map แยกไฟล์** (สไตล์ Substance Painter) ไม่ใช่ alpha channel
วัดพื้นที่จริง: `Cabin_Opacity` ขาว 97.1% / ดำ 1.0%, `Landing_gear_Opacity` **ขาว 99.2% ไม่มีดำเลย**
⇒ แทบไม่มีผลอะไร ลองปิดดู ถ้าไม่เห็นความต่างก็ลบทิ้งได้ ประหยัด texture 2 ใบ + ไม่ต้อง discard fragment

### 8.1 ตารางวัสดุ

7 material, ไฟล์อยู่ใน `textures/`

| material | mesh | Base color | Metallic | Roughness | Normal | อื่นๆ |
|---|---|---|---|---|---|---|
| `Airframe_Exterior` | 30 | `F22_Main_Fuselage_Base_color.png` | `..._Metallic.png` | ❌ ไม่มี | `..._Normal_OpenGL.png` | |
| `Interior_Cockpit_Bays` | 144 | `Cabin_Base_color.png` | `Cabin_Metallic.png` | `Cabin_Roughness.png` | `Cabin_Normal_OpenGL.png` | `Cabin_Emissive.png`, `Cabin_Opacity.png` |
| `LandingGear` | 75 | `Landing_gear_Base_color.png` | `Landing_gear_Metallic.png` | `Landing_gear_Roughness.png` | `Landing_gear_Normal_OpenGL.png` | `Landing_gear_Opacity.png` |
| `Details_Exterior_Fittings` | 14 | `Cockpit_+_details_Base_color.png` | `..._Metallic.png` | `..._Roughness.png` | `..._Normal_OpenGL.png` | `..._Height.png` (ไม่ต้องใช้) |
| `Details_Hook_TailUnderside` | 12 | `Tailhook_F_+_details_Base_color.png` | `..._Metallic.png` | `..._Roughness.png` | `..._Normal_OpenGL.png` | |
| `Weapons_Missiles` | 8 | `F22_RAPTOR_Weapons_Base_color.png` | `..._Metallic.png` | `..._Roughness.png` | `..._Normal.png` | |
| `Glass_Canopy` | 1 | — (ดูข้อ 9) | | | | |

### 8.2 กฎที่พลาดบ่อย

1. **`flipY = false` ทุกใบ** — glTF ใช้ UV กลับด้านจาก default ของ `TextureLoader` ลืมข้อนี้ = texture กลับหัวหมด
2. **colorSpace**: `SRGBColorSpace` เฉพาะ base color กับ emissive เท่านั้น อีก 4 ตัว (metalness/roughness/normal/alpha) ปล่อย default (linear)
3. 🔴 **`metalness = 1.0` และ `roughness = 1.0` เมื่อใส่ map** — Three.js เอา scalar **คูณ** กับ map ค่าใน Blender คือ metallic 0.0 / roughness 0.5 ถ้าลอกมาตรงๆ พร้อมใส่ map จะได้เครื่องบินที่ไม่มีความเป็นโลหะเลย
4. **ไม่ต้อง pack ORM** — Three.js อ่าน `.g` จาก roughnessMap และ `.b` จาก metalnessMap ไฟล์ grayscale มี r=g=b อยู่แล้ว ใส่แยกไฟล์ได้เลย
5. **`Airframe_Exterior` ไม่มีไฟล์ roughness** → ใส่ scalar ~0.45 แทน
6. **Opacity map → `alphaMap` + `alphaTest`** ไม่ใช่ `transparent: true` (Blender ตั้ง blend เป็น HASHED = alpha clip)
7. **Normal map เป็น OpenGL convention (+Y) ตรงกับ glTF อยู่แล้ว** ไม่ต้องกลับ channel
8. **mesh หลาย material = Group** — `Canopy_Glass` และอีก ~20 ชิ้น (`Bay_Center_Door_L`, `MLG_L_Door`, `NLG_Door_Rail_L`...) export ออกมาเป็น 2 primitive ⇒ `getObjectByName('Canopy_Glass').material` เป็น `undefined` เพราะมันเป็น Group ไม่ใช่ Mesh **ให้ traverse แล้วเช็คจากชื่อ material แทน**

### 8.3 โค้ด

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
    map:         tex('F22_Main_Fuselage_Base_color.png', true),
    metalnessMap:tex('F22_Main_Fuselage_Metallic.png'),
    normalMap:   tex('F22_Main_Fuselage_Normal_OpenGL.png'),
    metalness: 1.0,        // (3)
    roughness: 0.45,       // (5) ไม่มี map → ใช้ scalar
    envMapIntensity: 1.0,
  }),

  Interior_Cockpit_Bays: new THREE.MeshStandardMaterial({
    name: 'Interior_Cockpit_Bays',
    map:          tex('Cabin_Base_color.png', true),
    metalnessMap: tex('Cabin_Metallic.png'),
    roughnessMap: tex('Cabin_Roughness.png'),
    normalMap:    tex('Cabin_Normal_OpenGL.png'),
    emissiveMap:  tex('Cabin_Emissive.png', true),
    emissive: 0xffffff, emissiveIntensity: 1.2,          // จอ MFD ในค็อกพิต
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

  Glass_Canopy: makeCanopyGlass(),   // ดูข้อ 9
};

// (8) traverse แล้วสลับตามชื่อ material — ทำงานได้ทั้ง Mesh เดี่ยวและ Group หลาย primitive
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

## 9. กระจก canopy

ใน Blender: `Glass_Canopy` = alpha 0.30, roughness 0.05, **metallic 0.85**, IOR 1.45, blend BLEND
ค่านี้พอร์ตตรงๆ ไม่ได้ เพราะในโมเดล PBR **โลหะไม่ส่งผ่านแสง** — metalness สูง + transmission จะตีกัน ต้องเลือกทางใดทางหนึ่ง

**exporter ส่งอะไรมาให้:** material นี้ไม่มี texture เลย ออกมาเป็น `baseColorFactor [0.30, 0.21, 0.09, 0.30]`, `metallicFactor 0.85`, `roughnessFactor 0.05`, `alphaMode: BLEND` + extension `KHR_materials_ior` (1.45) และ `KHR_materials_specular`
GLTFLoader จะสร้าง `MeshPhysicalMaterial` ให้ แต่ **ไม่มี transmission** (Blender ตั้งไว้ 0) และ `depthWrite` ยังเป็น true ⇒ กระจกจะบังห้องนักบิน **ต้อง override ใน JS เสมอ**

`Canopy_Glass` มี 2 material slot (`Details_Exterior_Fittings` = กรอบ, `Glass_Canopy` = กระจก) → ใน Three.js เป็น Group 2 mesh ใช้ `applyMaterials` ข้างบนจัดการได้เลย

### แบบ A — tinted metal (แนะนำสำหรับเกม, ไม่มี pass เพิ่ม)

ให้ลุคเคลือบทอง ITO ของ F-22 ได้ตรง และเร็ว

```js
function makeCanopyGlass() {
  const m = new THREE.MeshPhysicalMaterial({
    name: 'Glass_Canopy',
    color: 0xb98a3f,          // เคลือบทอง indium-tin-oxide
    metalness: 1.0,
    roughness: 0.05,
    transparent: true,
    opacity: 0.28,
    envMapIntensity: 2.0,
    side: THREE.DoubleSide,
    depthWrite: false,        // ไม่งั้นบังของในค็อกพิต
  });
  return m;
}
// ให้วาดหลัง opaque เสมอ
jet.traverse(o => { if (o.isMesh && o.material?.name === 'Glass_Canopy') o.renderOrder = 10; });
```

### แบบ B — physical transmission (สวยกว่า, แพงกว่า)

```js
function makeCanopyGlass() {
  return new THREE.MeshPhysicalMaterial({
    name: 'Glass_Canopy',
    color: 0xffffff,
    metalness: 0.0,           // ต้อง 0 ถึงจะโปร่งได้
    roughness: 0.03,
    transmission: 1.0,
    thickness: 0.02,          // หน่วยเดียวกับโมเดล (~1 cm จริง)
    ior: 1.45,                // ตรงกับ Blender
    attenuationColor: 0xd4af5a,
    attenuationDistance: 0.5,
    iridescence: 1.0,         // เหลือบทอง
    iridescenceIOR: 1.3,
    iridescenceThicknessRange: [100, 400],
    envMapIntensity: 1.5,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
}
```

⚠️ `transmission > 0` ทำให้ Three.js เรนเดอร์ scene ซ้ำอีกรอบลง render target ทุกเฟรม — บนมือถือกินหนัก
⚠️ **ทั้งสองแบบต้องมี `scene.environment`** ไม่มี env map = กระจกดำสนิท

---

## 10. Optimize — 54.76 MB ส่งเข้าเกมตรงๆ ไม่ได้

ไฟล์ master ที่ export ออกมามี texture PNG ฝังอยู่ **54.76 MB** แต่ตัวเลขที่ฆ่าเกมจริงคือ VRAM:
**texture 4096×4096 RGBA แบบไม่บีบอัด = ~89 MB บน GPU** (รวม mipmap ×1.33) **ต่อใบเดียว**
ในไฟล์มี 19 ใบ ส่วนใหญ่ 4096² → เกิน 1 GB VRAM ถ้าไม่ทำอะไรเลย เครื่องระดับกลางตายแน่นอน

PNG บีบอัดเฉพาะตอนอยู่บนดิสก์ พอ decode ขึ้น GPU แล้วคลายเป็น raw หมด — **KTX2 คือรูปแบบเดียวที่ยังบีบอัดค้างอยู่บน GPU**

ติดตั้งครั้งเดียว:

```bash
npm i -g @gltf-transform/cli
```

### ทางเลือก A — Simple (คำสั่งเดียว)

```bash
gltf-transform etc1s F22_master.glb F22_game.glb --quality 200
```

แปลง texture ทุกใบเป็น **ETC1S** (Basis Universal) — บีบแน่น ~6-8 เท่า transcode ได้ทุกแพลตฟอร์ม
เหมาะกับ: ทำ prototype, อยากเห็นผลเร็ว, ยังไม่ซีเรียสเรื่องคุณภาพ normal map

ข้อเสีย: ETC1S ทำ **normal map พังเห็นชัด** — เกิด banding ตามแสงเงา เพราะ ETC1S บีบ 2 channel ที่ต้องแม่นยำแบบ lossy หนัก

### ทางเลือก B — Advanced (แยก codec ตามชนิด map)

```bash
# 1) ล้างของไม่ใช้ + ย่อขนาดก่อน (เร็ว)
gltf-transform prune  F22_master.glb F22_1.glb
gltf-transform dedup  F22_1.glb      F22_2.glb
gltf-transform resize F22_2.glb      F22_3.glb --width 2048 --height 2048

# 2) normal → UASTC
gltf-transform uastc F22_3.glb F22_4.glb \
  --slots "normalTexture" \
  --level 4 --rdo --rdo-lambda 1 --verbose

# 3) ที่เหลือ → ETC1S
gltf-transform etc1s F22_4.glb F22_5.glb --quality 200 --verbose

# 4) geometry
gltf-transform meshopt F22_5.glb F22_game.glb --level high

rm F22_1.glb F22_2.glb F22_3.glb F22_4.glb F22_5.glb
```

แต่ละขั้นทำอะไร:

| ขั้น | คำสั่ง | ผล |
|---|---|---|
| 1 | `prune` | ลบ material / texture / mesh / node ที่ไม่มีใครอ้างถึง (เช่น Height map ที่หลุดมา) |
| | `dedup` | รวม accessor / texture / material ที่ซ้ำกันเป๊ะให้เหลือชุดเดียว |
| | `resize` | ย่อทุก texture เหลือ 2048² — **ต้องทำก่อน encode** เพราะย่อทีหลังไม่ได้ ลด VRAM ลง 4 เท่าทันที |
| 2 | `uastc --slots normalTexture` | normal map ใช้ **UASTC** — คุณภาพสูงกว่า ETC1S มาก ไม่มี banding แลกกับไฟล์ใหญ่กว่า ~4 เท่า `--rdo` บีบเพิ่มตอน gzip โดยแทบไม่เสียคุณภาพ |
| 3 | `etc1s --quality 200` | ที่เหลือ (base color, ORM, emissive) ใช้ **ETC1S** — เล็กสุด ตาคนแทบไม่จับ artifact ใน albedo |
| 4 | `meshopt --level high` | บีบ vertex + index buffer (39k tris) แถมเร็วกว่า Draco ตอน decode |

ทำไมต้องแยก: ETC1S กับ UASTC เป็น Basis ทั้งคู่ แต่ ETC1S เน้นเล็ก UASTC เน้นแม่น
**base color ผิดนิดหน่อยตาไม่จับ แต่ normal ผิดนิดเดียวแสงเงาเพี้ยนทั้งลำ**

`--slots` รับ pattern ตามชื่อ slot ใน glTF: `baseColorTexture`, `normalTexture`, `metallicRoughnessTexture`, `emissiveTexture`, `occlusionTexture`

### ฝั่ง Three.js ต้องต่อ loader

ทั้งสองทางเลือกต้องมี `KTX2Loader` (+ `MeshoptDecoder` ถ้าใช้ทาง B) ดูโค้ดข้อ 5
และต้อง copy basis transcoder ไปไว้ที่ public:

```bash
cp -r node_modules/three/examples/jsm/libs/basis public/basis
```

### ตัดของที่ไม่ได้ใช้
`Interior_Cockpit_Bays` กิน 144 mesh (ค็อกพิต + ห้อง bay ทั้งหมด) ถ้าเกมเป็นมุมมองภายนอกล้วน ให้ซ่อนค็อกพิตตอน canopy ปิด:

```js
const cockpit = [];
jet.traverse(o => { if (o.isMesh && o.name.startsWith('Cockpit_')) cockpit.push(o); });
// ในลูป: cockpit.forEach(o => o.visible = M.canopy.progress > 0.01 || cameraIsClose);
```

### ปิด frustum culling ให้ชิ้นที่ขยับตาม bone

ถ้าเห็นชิ้นส่วนหายแวบๆ ตอน gear พับ:

```js
jet.traverse(o => { if (o.isMesh) o.frustumCulled = false; });
```

---

## 11. Loop หลัก

```js
const clock = new THREE.Clock();

function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.05);   // กัน dt กระโดดตอนสลับแท็บ

  update(dt);                                     // mechanism ทั้งหมด
  applyControls(input);                           // control surface
  applyVector(input.pitch, input.roll * 0.5);     // nozzle
  if (gear.down) spinWheels(groundSpeed, dt);

  renderer.render(scene, camera);
}
animate();
```

---

## 12. Checklist ก่อนส่งเข้าเกม

- [ ] `frame_set(1)` ก่อน export ทุกครั้ง (rest pose ต้องคงที่)
- [ ] `export_def_bones=False` — ถ้าลืม animation หายทั้งหมด
- [ ] ตรวจ GLB ด้วย script ข้อ 4.4: ต้องได้ 9 animation, `skinned 0`
- [ ] อย่าหา bone ด้วยชื่อ ให้ใช้ `mesh.parent`
- [ ] `subclip` endFrame ต้อง **+1** (exclusive)
- [ ] control surface หมุนรอบ **local Y** ของ bone เอง (nozzle: local **X**) — ห้ามใช้แกน world
- [ ] bay door ใช้ช่วง union 221–261 / 301–342 ทั้งสองข้าง
- [ ] snap state เริ่มต้นของทุก mechanism ตอนโหลดเสร็จ
- [ ] `scene.environment` ต้องมี ไม่งั้นกระจก + โลหะดำ
- [ ] override material `Glass_Canopy` + ตั้ง `renderOrder`
- [ ] ตั้ง `anisotropy` ให้ texture (GLTFLoader ไม่ตั้งให้)
- [ ] **อย่าส่ง `F22_master.glb` เข้าเกม** — ผ่าน pipeline ข้อ 10 ให้ได้ `F22_game.glb` ก่อน
- [ ] ต่อ `KTX2Loader` + copy `basis/` ไป public
- [ ] *(เฉพาะกรณีโหลด texture เอง)* `flipY = false` ทุกใบ, `metalness/roughness = 1.0` เมื่อมี map

---

## ภาคผนวก — ไฟล์ในโปรเจกต์

| ไฟล์ | คืออะไร |
|---|---|
| `F22.blend` | ไฟล์ทำงานหลัก (มี texture + rig + showcase) |
| `F22 no textures.blend` | เวอร์ชันก่อนใส่ texture |
| `F22_backup_before_rename_*.blend` | สำรองก่อน rename |
| `F22_rename_map.json` | ชื่อเก่า → ชื่อใหม่ 278 รายการ |
| `F22_revert_rename.py` | script ย้อน rename |
| `source/Lockheed Martin F-22.fbx` | ไฟล์ต้นทาง |
| `textures/` | PNG 28 ไฟล์ (~85 MB) |
