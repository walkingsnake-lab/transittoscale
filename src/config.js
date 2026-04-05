export const EARTH_RADIUS_METERS = 6_378_137;
export const METERS_PER_PIXEL = 180;
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
export const HOVER_SPRING = 11;
export const FONT_STACK = '"Reddit Sans Condensed", "Arial Narrow", Arial, sans-serif';
export const FONT_STACK_TIGHT = '"Inter Tight", "Reddit Sans Condensed", "Arial Narrow", Arial, sans-serif';
const DEFAULT_PAPER = '#f6f5f1';
const DEFAULT_PAPER_STRONG = '#ffffff';
const DEFAULT_INK = '#111111';
const DEFAULT_BORDER = '#111111';

const CITY_THEME_BY_SLUG = {
  'new-york': { accent: '#0039A6' },
  chicago: { accent: '#FF6319' },
  boston: { accent: '#6CBE45' },
  'washington-dc': { accent: '#EE352E' },
  'minneapolis-st-paul': { accent: '#B933AD' },
  seattle: { accent: '#FCCC0A' },
  toronto: { accent: '#996633' },
  montreal: { accent: '#A7A9AC' },
  london: { accent: '#DC241F' },
  'san-francisco-bay-area': { accent: '#00933C' }
};

const CITY_THEME_SEQUENCE = ['#0039A6', '#FF6319', '#6CBE45', '#EE352E', '#B933AD', '#FCCC0A', '#996633', '#A7A9AC', '#00933C'];

export function getCityTheme(slug, index = 0) {
  const accent = CITY_THEME_BY_SLUG[slug]?.accent ?? CITY_THEME_SEQUENCE[index % CITY_THEME_SEQUENCE.length];
  const accentRgb = hexToRgbTriplet(accent);
  const inkRgb = '17, 17, 17';

  return {
    accent,
    accentRgb,
    paper: DEFAULT_PAPER,
    paperStrong: DEFAULT_PAPER_STRONG,
    border: DEFAULT_BORDER,
    ink: DEFAULT_INK,
    text: DEFAULT_INK,
    mutedText: `rgba(${inkRgb}, 0.74)`,
    regionText: `rgba(${inkRgb}, 0.56)`,
    cardStroke: `rgba(${inkRgb}, 0.12)`,
    referenceFill: `rgb(${accentRgb})`,
    selectedGlow: `rgba(${accentRgb}, 0.06)`,
    selectedCardStroke: accent,
    shadow: 'rgba(0, 0, 0, 0.18)'
  };
}

export const CARD_STYLE = {
  baseLineWidth: 1.65,
  selectedLineWidth: 2.15,
  haloWidthPadding: 1.7,
  baseAlpha: 0.94,
  dimmedAlpha: 0.18,
  haloAlpha: 0.78,
  dimmedHaloAlpha: 0.24,
  simplifyTolerance: 0.5,
  lineStroke: DEFAULT_INK
};

function hexToRgbTriplet(hex) {
  const normalized = hex.replace('#', '');
  const bigint = Number.parseInt(normalized, 16);
  const r = (bigint >> 16) & 255;
  const g = (bigint >> 8) & 255;
  const b = bigint & 255;
  return `${r}, ${g}, ${b}`;
}
