/*
The short-range heater. Two ride the F-22's side bays, swung out on their rails before
launch, which is why the airframe carries only a pair of them.
*/
const aim9 = {
  id: 'aim9',
  designation: 'AIM-9X',
  displayName: 'AIM-9X Sidewinder',
  role: 'Short-range IR',
  url: '/AIM9_master.glb',

  // The export's root node carries an arbitrary quaternion, but it resolves to a body
  // lying along +Z with the nose at +Z. This turns that onto the display's own axis:
  // nose along +X, fins level. Every weapon module states its own correction, so a weapon
  // exported nose-up or nose-down needs no code change anywhere else.
  modelRotation: [0, Math.PI / 2, 0],

  // Real length in metres. The display derives one metres-to-world-units factor for the
  // whole display from these, so a Sidewinder is never drawn longer than an AMRAAM just
  // because its .glb was authored at a different scale.
  lengthMetres: 3.02,

  spec: [
    ['Length', '3.02 m'],
    ['Diameter', '127 mm'],
    ['Launch mass', '85.3 kg'],
    ['Guidance', 'Imaging infrared'],
    ['Warhead', '9.4 kg annular blast-frag'],
    ['Range', '≈ 35 km'],
    ['Speed', 'Mach 2.5+'],
  ],
}

export default aim9
