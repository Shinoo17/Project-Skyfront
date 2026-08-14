/*
The fixed text of the pause screen: what the command column offers, what the settings panel
is divided into, and what the credits can honestly claim.
*/

// Credit only what the repository can actually prove: the assets it ships and the libraries
// it builds on. No names or licences are invented here — an attribution nobody supplied is
// worse than a short panel.
export const CREDITS = [
  { role: 'Engine', detail: 'React · Three.js · @react-three/fiber · @react-three/drei' },
  { role: 'Interface', detail: 'Vite · lucide-react · hand-drawn canvas HUD' },
  { role: 'Flight model', detail: '6-DOF-lite simulation written for this project' },
  { role: 'Input prompts', detail: 'Keyboard and mouse prompt set shipped in this repository' },
]

export const COMMANDS = [
  { id: 'resume', label: 'Resume', sub: 'Back to the seat · ESC' },
  { id: 'settings', label: 'Settings', sub: 'Gameplay · control · graphics · camera · audio' },
  { id: 'credits', label: 'Game credits', sub: 'What this is built out of' },
  { id: 'exit', label: 'Back to main', sub: 'Leave the range for the hangar' },
]

export const TABS = [
  { id: 'gameplay', label: 'GAMEPLAY' },
  { id: 'controls', label: 'CONTROLS' },
  { id: 'graphics', label: 'GRAPHICS' },
  { id: 'camera', label: 'CAMERA' },
  { id: 'audio', label: 'AUDIO' },
]

export const VIEW_TITLES = {
  root: ['SORTIE PAUSED', 'Standing by'],
  settings: ['SETTINGS', 'Tune the sortie'],
  credits: ['GAME CREDITS', 'Built out of'],
}
