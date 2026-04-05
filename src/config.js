export const EARTH_RADIUS_METERS = 6_378_137;
export const METERS_PER_PIXEL = 160;
export const CARD_CANVAS_HEIGHT = 440;
export const CARD_PADDING = 20;
export const HEADER_OFFSET = 0;
export const REFERENCE_MILES = 5;
export const METERS_PER_MILE = 1_609.344;
export const REFERENCE_METERS = REFERENCE_MILES * METERS_PER_MILE;
export const REFERENCE_RADIUS_PIXELS = REFERENCE_METERS / METERS_PER_PIXEL;
export const INTRO_STAGGER_MS = 70;
export const INTRO_DURATION_MS = 1_250;
export const INTRO_CIRCLE_PORTION = 0.36;
export const REVEAL_LINE_OFFSET = 0.085;
export const SELECTION_SPRING = 12;
export const DIM_SPRING = 9;
export const FONT_STACK = '"Inter", "Helvetica Neue", Helvetica, Arial, sans-serif';

const DEFAULT_SURFACE = '#17191d';
const DEFAULT_SURFACE_STRONG = '#20242a';
const DEFAULT_BORDER = '#2e333c';

const CITY_THEME_BY_SLUG = {
  'new-york': { accent: '#0039A6' },
  chicago: { accent: '#00933C' },
  boston: { accent: '#EE352E' },
  'washington-dc': { accent: '#FCCC0A' },
  'minneapolis-st-paul': { accent: '#FF6319' },
  seattle: { accent: '#6CBE45' },
  toronto: { accent: '#B933AD' }
};

const CITY_THEME_SEQUENCE = ['#0039A6', '#EE352E', '#00933C', '#FCCC0A', '#FF6319', '#B933AD', '#6CBE45', '#996633'];

export function getCityTheme(slug, index = 0) {
  const accent = CITY_THEME_BY_SLUG[slug]?.accent ?? CITY_THEME_SEQUENCE[index % CITY_THEME_SEQUENCE.length];
  const accentRgb = hexToRgbTriplet(accent);
  const textRgb = '216, 221, 228';

  return {
    accent,
    accentRgb,
    surface: CITY_THEME_BY_SLUG[slug]?.surface ?? DEFAULT_SURFACE,
    surfaceStrong: CITY_THEME_BY_SLUG[slug]?.surfaceStrong ?? DEFAULT_SURFACE_STRONG,
    border: CITY_THEME_BY_SLUG[slug]?.border ?? DEFAULT_BORDER,
    text: '#d8dde4',
    mutedText: `rgba(${textRgb}, 0.82)`,
    regionText: `rgba(${textRgb}, 0.64)`,
    gridStroke: 'transparent',
    cardStroke: `rgba(${textRgb}, 0.08)`,
    referenceStroke: `rgba(${textRgb}, 0.42)`,
    selectedGlow: `rgba(${textRgb}, 0.04)`,
    selectedCardStroke: accent,
    overlayFill: CITY_THEME_BY_SLUG[slug]?.surfaceStrong ?? DEFAULT_SURFACE_STRONG
  };
}

export const CARD_STYLE = {
  baseLineWidth: 1.7,
  selectedLineWidth: 2.55,
  baseAlpha: 0.9,
  dimmedAlpha: 0.22,
  lineStroke: '#d2d7de'
};

function hexToRgbTriplet(hex) {
  const normalized = hex.replace('#', '');
  const bigint = Number.parseInt(normalized, 16);
  const r = (bigint >> 16) & 255;
  const g = (bigint >> 8) & 255;
  const b = bigint & 255;
  return `${r}, ${g}, ${b}`;
}
