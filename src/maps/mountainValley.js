/*
The first range: the Colorado valley the sortie has always flown over.

Every number here used to be a constant inside the flight scene. Nothing was changed in
the move — the values are exactly what the range was hardcoding — so the sortie flies the
same today as it did before the map registry existed.

`span` is the world size the terrain is rescaled to along its longest horizontal axis;
everything else that depends on the range size is derived from the terrain's own bounds at
that scale, so a taller or wider .glb needs no new numbers here.
*/
const mountainValley = {
  id: 'mountain-valley-colorado',
  name: 'Mountain Valley',
  region: 'Colorado',
  // What the loader screen says while this range streams in, and what it tells the pilot
  // to check when it fails. Named per map so a second range never blames the first one's
  // asset for its own missing file.
  loading: 'LOADING MOUNTAIN RANGE',
  url: '/Mountain_Valley_Colorado.glb',
  assets: ['Mountain_Valley_Colorado.glb'],

  // Terrain footprint in world units, and how far inside the mesh edge the range wall sits.
  span: 3600,
  edgeMargin: 70,

  // Where a sortie begins. Altitude is a floor: the real spawn clears the terrain's own
  // height by `spawn.clearance`, whichever is higher.
  spawn: { x: -260, z: 0, minAltitude: 190, clearance: 58 },

  // The ceiling is measured from the top of the terrain, not from sea level, so a range
  // with taller peaks does not squeeze the usable airspace above them.
  ceilingAboveTerrain: 1460,

  // Sky, haze, and sun. `clearColor` is what the renderer paints behind everything, `fog`
  // is the linear range the terrain fades over, and the two lights are the whole lighting
  // rig — this range carries no environment map.
  environment: {
    clearColor: '#688293',
    toneMappingExposure: 1.05,
    fog: { color: '#78909d', near: 460, far: 2700 },
    hemisphere: { sky: '#dbe9ee', ground: '#26352f', intensity: 2.2 },
    sun: { position: [-180, 260, 120], intensity: 2.8, color: '#fff2d4' },
  },

  // Camera clipping for anything flying this range. `far` is a little past the fog so the
  // haze, not the frustum, is what ends the view.
  camera: { near: 0.3, far: 3600 },

  // The free-orbit observer only. Held inside the fog on purpose: past it the aircraft is
  // a grey smudge, and an observer page whose first drag loses the jet reads as broken.
  observer: { minDistance: 14, maxDistance: 1200, far: 6000 },
}

export default mountainValley
