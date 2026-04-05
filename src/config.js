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

export function getCityTheme(slug, index = 0) {
  const accent = '#111111';
  const accentRgb = '17, 17, 17';
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
    referenceStroke: `rgba(${inkRgb}, 0.24)`,
    selectedGlow: `rgba(${inkRgb}, 0.03)`,
    selectedCardStroke: DEFAULT_INK,
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
