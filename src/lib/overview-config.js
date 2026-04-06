import { CARD_CANVAS_HEIGHT } from '../config.js';

export const OVERVIEW_BASE_WIDTH = 340;
export const OVERVIEW_BASE_HEIGHT = CARD_CANVAS_HEIGHT;
export const OVERVIEW_RASTER_SCALE = 2;
export const OVERVIEW_SAFE_INSET = 12;
export const DEFAULT_OVERVIEW_VARIANT = 'standard';
export const DETAIL_BASE_WIDTH = 680;
export const DETAIL_BASE_HEIGHT = DETAIL_BASE_WIDTH * OVERVIEW_BASE_HEIGHT / OVERVIEW_BASE_WIDTH;
export const DETAIL_RASTER_SCALE = 2;
export const DETAIL_SAFE_INSET = 18;
export const DETAIL_DIAGRAM_SCALE = 1.18;

export const OVERVIEW_ZOOM_STEPS = Object.freeze([
  Object.freeze({ key: 'wide', label: 'Wide', diagramScale: 0.82 }),
  Object.freeze({ key: DEFAULT_OVERVIEW_VARIANT, label: 'Standard', diagramScale: 1 }),
  Object.freeze({ key: 'close', label: 'Close', diagramScale: 1.18 })
]);
