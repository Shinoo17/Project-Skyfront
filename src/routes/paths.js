// One place for route paths so the topbar, redirects, and future surfaces
// (dogfight, settings) never drift apart.
export const VIEWER_PATH = '/'

// The sortie. The URL is unchanged from before the range became one map among many —
// it is the link people already have.
export const FLIGHT_RANGE_PATH = '/test-flight'

// Developer surfaces live under /dev so they are obviously not part of the game.
export const DEV_TEST_FLIGHT_PATH = '/dev/test-flight'
