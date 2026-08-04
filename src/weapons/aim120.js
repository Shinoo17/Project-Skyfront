/*
The beyond-visual-range shot. Six stow in the F-22's main bay, which is the loadout the
airframe is shaped around.
*/
const aim120 = {
  id: 'aim120',
  designation: 'AIM-120C',
  displayName: 'AIM-120C AMRAAM',
  role: 'Medium-range active radar',
  url: '/AIM120_master.glb',

  // Sketchfab's root node already lays the body along +Z, nose at +Z. Same correction as
  // the Sidewinder: quarter turn about Y to put the nose on +X.
  modelRotation: [0, Math.PI / 2, 0],

  lengthMetres: 3.66,

  spec: [
    ['Length', '3.66 m'],
    ['Diameter', '178 mm'],
    ['Launch mass', '161.5 kg'],
    ['Guidance', 'Inertial + active radar'],
    ['Warhead', '18 kg blast-frag'],
    ['Range', '≈ 105 km'],
    ['Speed', 'Mach 4'],
  ],
}

export default aim120
