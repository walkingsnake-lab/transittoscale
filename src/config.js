export const EARTH_RADIUS_METERS = 6_378_137;
export const METERS_PER_PIXEL = 160;
export const CARD_CANVAS_HEIGHT = 400;
export const CARD_PADDING = 24;
export const HEADER_OFFSET = 8;
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

export const CARD_STYLE = {
  baseLineWidth: 1.55,
  selectedLineWidth: 2.35,
  baseAlpha: 0.9,
  dimmedAlpha: 0.16,
  neutralStroke: '#15211d',
  referenceStroke: '#94785b',
  gridStroke: 'rgba(24, 38, 32, 0.07)',
  cardStroke: 'rgba(17, 24, 20, 0.12)',
  selectedCardStroke: 'rgba(17, 24, 20, 0.62)',
  selectedGlow: 'rgba(186, 145, 91, 0.22)'
};
