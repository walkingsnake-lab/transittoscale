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
const DEFAULT_PAPER = '#f6f5f1';
const DEFAULT_PAPER_STRONG = '#ffffff';
const DEFAULT_INK = '#111111';
const DEFAULT_BORDER = '#111111';

const CITY_THEME_BY_SLUG = {
  'new-york': { accent: '#244f9e' },
  chicago: { accent: '#2d7a5a' },
  boston: { accent: '#a33f36' },
  'washington-dc': { accent: '#b08a3f' },
  'minneapolis-st-paul': { accent: '#8f5c96' },
  seattle: { accent: '#4f7a59' },
  toronto: { accent: '#5c64a8' },
  montreal: { accent: '#c26b2d' },
  'san-francisco-bay-area': { accent: '#2c6f8f' }
};

const CITY_THEME_SEQUENCE = ['#244f9e', '#2d7a5a', '#a33f36', '#b08a3f', '#8f5c96', '#4f7a59', '#5c64a8', '#c26b2d', '#2c6f8f'];

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
    referenceFill: `rgba(${accentRgb}, 0.14)`,
    selectedGlow: `rgba(${accentRgb}, 0.035)`,
    selectedCardStroke: accent,
    shadow: 'rgba(0, 0, 0, 0.18)'
  };
}

export const CARD_STYLE = {
  baseLineWidth: 1.65,
  selectedLineWidth: 2.15,
  baseAlpha: 0.94,
  dimmedAlpha: 0.18,
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
