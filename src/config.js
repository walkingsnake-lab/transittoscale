export const EARTH_RADIUS_METERS = 6_378_137;
export const METERS_PER_PIXEL = 180;
export const CARD_CANVAS_HEIGHT = 440;
export const CARD_PADDING = 20;
export const HEADER_OFFSET = 0;
export const REFERENCE_MILES = 5;
export const METERS_PER_MILE = 1_609.344;
export const REFERENCE_METERS = REFERENCE_MILES * METERS_PER_MILE;
export const REFERENCE_RADIUS_PIXELS = REFERENCE_METERS / METERS_PER_PIXEL;
export const INTRO_STAGGER_MS = 90;
export const INTRO_DURATION_MS = 1_800;
export const INTRO_CARD_PORTION = 0.28;
export const INTRO_CIRCLE_DELAY = 0.16;
export const INTRO_CIRCLE_PORTION = 0.3;
export const INTRO_LINES_DELAY = 0.34;
export const REVEAL_LINE_OFFSET = 0.16;
export const LINE_TRACER_WINDOW = 0.16;
export const SELECTION_SPRING = 12;
export const DIM_SPRING = 9;
export const HOVER_SPRING = 11;
export const FONT_STACK = '"Inter Tight", Inter, Arial, sans-serif';
export const FONT_STACK_TIGHT = '"Inter Tight", Inter, Arial, sans-serif';
const DEFAULT_PAPER = '#f6f5f1';
const DEFAULT_PAPER_STRONG = '#ffffff';
const DEFAULT_INK = '#111111';
const DEFAULT_BORDER = '#111111';

const CITY_THEME_BY_SLUG = {
  atlanta: { accent: '#c89826' },
  baltimore: { accent: '#2e8a63' },
  'new-york': { accent: '#2e5ea8' },
  chicago: { accent: '#d05d2a' },
  boston: { accent: '#62944a' },
  'washington-dc': { accent: '#c44b47' },
  'minneapolis-st-paul': { accent: '#8354ae' },
  seattle: { accent: '#b58f22' },
  portland: { accent: '#3f8a5a' },
  'los-angeles': { accent: '#cc7d31' },
  vancouver: { accent: '#3a6ea6' },
  edmonton: { accent: '#4679a6' },
  'st-louis': { accent: '#4a789f' },
  philadelphia: { accent: '#335f92' },
  pittsburgh: { accent: '#b79634' },
  toronto: { accent: '#8b6846' },
  montreal: { accent: '#8a929a' },
  madrid: { accent: '#b54261' },
  stockholm: { accent: '#4c83aa' },
  london: { accent: '#c6504c' },
  'san-francisco-bay-area': { accent: '#3b8b67' },
  'san-jose-santa-clara-valley': { accent: '#3b8f78' }
};

const CITY_THEME_SEQUENCE = ['#2e5ea8', '#d05d2a', '#62944a', '#c44b47', '#8354ae', '#b58f22', '#8b6846', '#8a929a', '#3b8b67'];

export function getCityTheme(slug, index = 0) {
  const accent = CITY_THEME_BY_SLUG[slug]?.accent ?? CITY_THEME_SEQUENCE[index % CITY_THEME_SEQUENCE.length];
  const accentColor = hexToRgb(accent);
  const accentRgb = toRgbTriplet(accentColor);
  const paperStrongColor = hexToRgb(DEFAULT_PAPER_STRONG);
  const inkColor = hexToRgb(DEFAULT_INK);
  const referenceCircleRgb = toRgbTriplet(mixRgb(accentColor, paperStrongColor, 0.82));
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
    referenceFill: `rgb(${referenceCircleRgb})`,
    selectedGlow: `rgba(${accentRgb}, 0.06)`,
    selectedCardStroke: accent,
    shadow: 'rgba(0, 0, 0, 0.18)'
  };
}

export const CARD_STYLE = {
  baseLineWidth: 1.65,
  selectedLineWidth: 2.15,
  baseAlpha: 0.94,
  dimmedAlpha: 0.18,
  simplifyTolerance: 0.5,
  lineStroke: DEFAULT_INK
};

function hexToRgb(hex) {
  const normalized = hex.replace('#', '');
  const bigint = Number.parseInt(normalized, 16);
  return {
    r: (bigint >> 16) & 255,
    g: (bigint >> 8) & 255,
    b: bigint & 255
  };
}

function toRgbTriplet({ r, g, b }) {
  return `${r}, ${g}, ${b}`;
}

function mixRgb(left, right, rightShare) {
  const clampedShare = Math.min(Math.max(rightShare, 0), 1);
  const leftShare = 1 - clampedShare;

  return {
    r: Math.round(left.r * leftShare + right.r * clampedShare),
    g: Math.round(left.g * leftShare + right.g * clampedShare),
    b: Math.round(left.b * leftShare + right.b * clampedShare)
  };
}
