// Penny Pinching Trivia visual theme — matched to the marketing site:
// bright brand-blue backgrounds with the playful pink / gold / cyan accents.
// Shared across screens for a consistent look with pennypinchingtrivia.com.
export const theme = {
  bg: '#1657D6', // brand blue (marketing hero family) — was midnight navy
  bgDeep: '#0F3F9E', // deeper blue for the web letterbox / behind-app surround
  surface: '#1E63E8', // blue card
  surfaceAlt: '#2A72F5',
  border: '#4A86FF',

  emerald: '#2BE0A6', // correct / money / primary actions (pops on blue)
  emeraldDeep: '#12A87A',
  gold: '#FFC22E', // prize pool / top-3 (marketing gold)
  crimson: '#FF4D7D', // incorrect / danger (marketing pink-red)

  // Extra marketing accents, available to screens.
  pink: '#FF3D74',
  cyan: '#8EE7F3',
  blue: '#37A0FF',

  text: '#FFFFFF',
  textMuted: '#C3D5F7', // blue-tinted muted (was neutral gray)
} as const;

export const money = (cents: number) =>
  `$${(cents / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
