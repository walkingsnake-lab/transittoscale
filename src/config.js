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
export const DISPLAY_FONT_STACK = '"Cormorant Garamond", Georgia, serif';

const DEFAULT_PAPER = '#eee0c8';
const DEFAULT_PAPER_STRONG = '#f5ead6';
const DEFAULT_INK = '#2b241e';
const DEFAULT_BORDER = '#9c8466';

const CITY_THEME_BY_SLUG = {
  'new-york': { accent: '#7d2b31' },
  chicago: { accent: '#315f7a' },
  boston: { accent: '#426b52' },
  'washington-dc': { accent: '#9d7840' },
  'minneapolis-st-paul': { accent: '#a3563f' },
  seattle: { accent: '#586f5a' },
  toronto: { accent: '#6b4d76' },
  montreal: { accent: '#c26b2d' },
  'san-francisco-bay-area': { accent: '#2c6f8f' }
};

const CITY_THEME_SEQUENCE = ['#7d2b31', '#315f7a', '#426b52', '#9d7840', '#a3563f', '#6b4d76', '#586f5a', '#7b5d3f'];

export function getCityTheme(slug, index = 0) {
  const accent = CITY_THEME_BY_SLUG[slug]?.accent ?? CITY_THEME_SEQUENCE[index % CITY_THEME_SEQUENCE.length];
  const accentRgb = hexToRgbTriplet(accent);
  const inkRgb = '43, 36, 30';

  return {
    accent,
    accentRgb,
    paper: CITY_THEME_BY_SLUG[slug]?.paper ?? DEFAULT_PAPER,
    paperStrong: CITY_THEME_BY_SLUG[slug]?.paperStrong ?? DEFAULT_PAPER_STRONG,
    border: CITY_THEME_BY_SLUG[slug]?.border ?? DEFAULT_BORDER,
    ink: CITY_THEME_BY_SLUG[slug]?.ink ?? DEFAULT_INK,
    text: DEFAULT_INK,
    mutedText: `rgba(${inkRgb}, 0.78)`,
    regionText: `rgba(${inkRgb}, 0.62)`,
    cardStroke: `rgba(${inkRgb}, 0.14)`,
    referenceStroke: `rgba(${accentRgb}, 0.5)`,
    selectedGlow: `rgba(${accentRgb}, 0.08)`,
    selectedCardStroke: accent,
    headerRule: `rgba(${accentRgb}, 0.46)`,
    cornerText: accent,
    shadow: 'rgba(21, 16, 12, 0.22)'
  };
}

export const CARD_STYLE = {
  baseLineWidth: 1.7,
  selectedLineWidth: 2.45,
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
