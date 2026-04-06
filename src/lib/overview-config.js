import { CARD_CANVAS_HEIGHT } from '../config.js';

export const OVERVIEW_BASE_WIDTH = 340;
export const OVERVIEW_BASE_HEIGHT = CARD_CANVAS_HEIGHT;
export const OVERVIEW_RASTER_SCALE = 2;
export const DEFAULT_OVERVIEW_VARIANT = 'standard';

export const OVERVIEW_ZOOM_STEPS = Object.freeze([
  Object.freeze({ key: 'wide', label: 'Wide', diagramScale: 0.82 }),
  Object.freeze({ key: DEFAULT_OVERVIEW_VARIANT, label: 'Standard', diagramScale: 1 }),
  Object.freeze({ key: 'close', label: 'Close', diagramScale: 1.18 })
]);
