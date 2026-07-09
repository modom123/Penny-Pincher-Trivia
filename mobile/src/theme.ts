// Penny Pincher visual theme (from the game-design brief): midnight dark mode,
// with Electric Emerald (money/growth) and Neon Gold (prize pool / top positions)
// as the two accents. Shared across screens for a consistent look.
export const theme = {
  bg: '#0A0E1A', // midnight navy
  surface: '#131A2A',
  surfaceAlt: '#1B2438',
  border: '#243049',

  emerald: '#12E29A', // electric emerald - money, correct, primary actions
  emeraldDeep: '#0BA574',
  gold: '#FFD23F', // neon gold - prize pool, top-3
  crimson: '#FF4D5E', // incorrect / danger / sudden death

  text: '#FFFFFF',
  textMuted: '#8A93A6',
} as const;

export const money = (cents: number) =>
  `$${(cents / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
