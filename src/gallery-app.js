import { getCityTheme } from './config.js';
import {
  DEFAULT_OVERVIEW_VARIANT,
  DETAIL_BASE_HEIGHT,
  DETAIL_BASE_WIDTH,
  DETAIL_DIAGRAM_SCALE,
  DETAIL_SAFE_INSET,
  OVERVIEW_ZOOM_STEPS
} from './lib/overview-config.js';
import { createOverviewDiagramSvg, getOverviewDiagramLayout } from './lib/overview-diagram.js';
import { clamp } from './lib/math.js';
import { shouldUseSoftHoverEffects, supportsInteractiveDepthEffects } from './lib/platform.js';

const CITY_ORDER_COLLATOR = new Intl.Collator('en', { sensitivity: 'base' });
const IMAGE_LOAD_CACHE = new Map();
const CITY_GEOJSON_CACHE = new Map();
const DETAIL_DIAGRAM_CACHE = new Map();
const MAX_OVERVIEW_CARD_HEIGHT = 560;
const DETAIL_MIN_ZOOM = 1;
const DETAIL_MAX_ZOOM = 6;
const DETAIL_BUTTON_ZOOM_FACTOR = 1.35;
const DETAIL_WHEEL_ZOOM_SENSITIVITY = 0.0015;
const DETAIL_PAN_OVERSCROLL_FRACTION = 0.16;

export async function mountApp(root) {
  root.innerHTML = `
    <main class="shell" data-shell>
      <header class="shell__toolbar" data-toolbar>
        <div class="zoom-controls" role="group" aria-label="Diagram zoom controls">
          <button type="button" class="zoom-controls__button" data-zoom-out aria-label="Zoom out network diagrams">
            <svg class="zoom-controls__icon" viewBox="0 0 16 16" aria-hidden="true">
              <path d="M4 8H12"></path>
            </svg>
          </button>
          <div class="zoom-controls__steps" aria-hidden="true">
            <span class="zoom-controls__step" data-zoom-step></span>
            <span class="zoom-controls__step" data-zoom-step></span>
            <span class="zoom-controls__step" data-zoom-step></span>
          </div>
          <button type="button" class="zoom-controls__button" data-zoom-in aria-label="Zoom in network diagrams">
            <svg class="zoom-controls__icon" viewBox="0 0 16 16" aria-hidden="true">
              <path d="M4 8H12"></path>
              <path d="M8 4V12"></path>
            </svg>
          </button>
          <span class="shell__sr-only" data-zoom-label aria-live="polite">Standard</span>
        </div>
      </header>
      <section class="shell__status" data-status>Loading network catalog...</section>
      <section class="grid" data-grid aria-live="polite"></section>
      <aside class="detail-view" data-detail-view hidden aria-hidden="true">
        <button type="button" class="detail-view__backdrop" data-detail-backdrop aria-label="Close selected transit system"></button>
        <div class="detail-view__slot" data-detail-slot></div>
        <button type="button" class="detail-card__close" data-detail-close aria-label="Close selected transit system">
          <span aria-hidden="true">&times;</span>
        </button>
      </aside>
    </main>
  `;

  const shell = root.querySelector('[data-shell]');
  const toolbar = root.querySelector('[data-toolbar]');
  const status = root.querySelector('[data-status]');
  const grid = root.querySelector('[data-grid]');
  const zoomLabel = root.querySelector('[data-zoom-label]');
  const zoomSteps = Array.from(root.querySelectorAll('[data-zoom-step]'));
  const zoomOutButton = root.querySelector('[data-zoom-out]');
  const zoomInButton = root.querySelector('[data-zoom-in]');
  const detailView = root.querySelector('[data-detail-view]');
  const detailSlot = root.querySelector('[data-detail-slot]');
  const detailBackdrop = root.querySelector('[data-detail-backdrop]');
  const detailCloseButton = root.querySelector('[data-detail-close]');
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const softHoverEffects = shouldUseSoftHoverEffects();
  const interactiveDepth = !reducedMotion && supportsInteractiveDepthEffects();
  shell.classList.toggle('shell--soft-hover', softHoverEffects);
  let selectedCard = null;
  let detailCard = null;
  let detailHideTimeoutId = 0;
  let lastActiveTrigger = null;
  let layoutFrameId = 0;
  let detailRequestId = 0;

  try {
    const cities = await loadCities();
    status.textContent = `${cities.length} metro systems loaded. Select a card to inspect a larger diagram.`;

    const cards = cities.map((city, index) =>
      createCard(city, index, {
        reducedMotion,
        interactiveDepth,
        onOpen(card, triggerElement) {
          openDetail(card, triggerElement);
        }
      })
    );

    cards.forEach(({ element }) => grid.append(element));

    let zoomIndex = OVERVIEW_ZOOM_STEPS.findIndex((step) => step.key === DEFAULT_OVERVIEW_VARIANT);

    if (zoomIndex < 0) {
      zoomIndex = 1;
    }

    function syncZoomControls() {
      const zoomStep = OVERVIEW_ZOOM_STEPS[zoomIndex];

      zoomLabel.textContent = zoomStep.label;
      zoomSteps.forEach((step, index) => step.classList.toggle('zoom-controls__step--active', index === zoomIndex));
      zoomOutButton.disabled = zoomIndex === 0;
      zoomInButton.disabled = zoomIndex === OVERVIEW_ZOOM_STEPS.length - 1;
      cards.forEach((card) => card.setOverviewVariant(zoomStep.key));
    }

    function applyLayout() {
      const chromeHeight = toolbar ? Math.ceil(toolbar.getBoundingClientRect().height) + 18 : 0;

      updateGridLayout(grid, cards.length, { chromeHeight });
      syncZoomControls();
      cards.forEach((card) => card.syncDiagramPosition());

      if (selectedCard && detailCard) {
        applyFixedRect(detailCard.element, getDetailTargetRect(selectedCard));
        detailCard.syncViewerLayout();
      }
    }

    function requestLayoutSync() {
      if (layoutFrameId) {
        cancelAnimationFrame(layoutFrameId);
      }

      layoutFrameId = requestAnimationFrame(() => {
        layoutFrameId = 0;
        applyLayout();
      });
    }

    function setZoomIndex(nextZoomIndex) {
      const boundedZoomIndex = clamp(nextZoomIndex, 0, OVERVIEW_ZOOM_STEPS.length - 1);

      if (boundedZoomIndex === zoomIndex) {
        return;
      }

      zoomIndex = boundedZoomIndex;
      syncZoomControls();
    }

    function syncSelection() {
      const hasSelection = selectedCard !== null;

      cards.forEach((card) => card.setSelected(card === selectedCard, hasSelection));
      shell.classList.toggle('shell--detail-open', hasSelection);
      document.body.classList.toggle('body--detail-open', hasSelection);
    }

    function showDetailView() {
      if (detailHideTimeoutId) {
        window.clearTimeout(detailHideTimeoutId);
        detailHideTimeoutId = 0;
      }

      detailView.hidden = false;
      detailView.setAttribute('aria-hidden', 'false');
    }

    function openDetail(card, triggerElement) {
      if (selectedCard === card) {
        closeDetail();
        return;
      }

      if (selectedCard) {
        closeDetail({ instant: true, restoreFocus: false });
      }

      lastActiveTrigger = triggerElement;
      selectedCard = card;
      const nextDetailRequestId = detailRequestId + 1;
      detailRequestId = nextDetailRequestId;
      detailCard = createDetailCard(card, { requestId: nextDetailRequestId });

      const startRect = card.element.getBoundingClientRect();

      showDetailView();
      detailSlot.replaceChildren(detailCard.element);
      card.setHovered(false);
      card.resetTilt();
      syncSelection();
      applyFixedRect(detailCard.element, startRect);

      requestAnimationFrame(() => {
        if (!detailCard || detailCard.requestId !== nextDetailRequestId || selectedCard !== card) {
          return;
        }

        detailView.classList.add('detail-view--open');
        applyFixedRect(detailCard.element, getDetailTargetRect(card));
        detailCard.syncViewerLayout();
      });

      detailCard.loadLiveDiagram(() => detailCard?.requestId === nextDetailRequestId && selectedCard === card);

      detailCloseButton.focus({ preventScroll: true });
    }

    function closeDetail({ instant = false, restoreFocus = true } = {}) {
      if (!selectedCard && detailView.hidden) {
        return;
      }

      const focusTarget = lastActiveTrigger;
      const card = selectedCard;
      const activeDetailCard = detailCard;

      if (!card || !activeDetailCard) {
        detailSlot.textContent = '';
        activeDetailCard?.destroy?.();
        detailCard = null;
        selectedCard = null;
        syncSelection();
        detailView.hidden = true;
        detailView.setAttribute('aria-hidden', 'true');
        return;
      }

      detailView.classList.remove('detail-view--open');
      detailView.setAttribute('aria-hidden', 'true');
      applyFixedRect(activeDetailCard.element, card.element.getBoundingClientRect());

      if (detailHideTimeoutId) {
        window.clearTimeout(detailHideTimeoutId);
      }

      const finalizeClose = () => {
        activeDetailCard.destroy();
        detailSlot.textContent = '';
        detailCard = null;
        selectedCard = null;
        syncSelection();
        detailView.hidden = true;
        detailHideTimeoutId = 0;

        if (restoreFocus && focusTarget instanceof HTMLElement) {
          requestAnimationFrame(() => {
            focusTarget.focus({ preventScroll: true });
          });
        }
      };

      if (instant || reducedMotion) {
        finalizeClose();
        return;
      }

      detailHideTimeoutId = window.setTimeout(finalizeClose, 260);
    }

    zoomOutButton.addEventListener('click', () => setZoomIndex(zoomIndex - 1));
    zoomInButton.addEventListener('click', () => setZoomIndex(zoomIndex + 1));
    detailBackdrop.addEventListener('click', closeDetail);
    detailCloseButton.addEventListener('click', closeDetail);
    window.addEventListener('resize', requestLayoutSync);
    window.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && selectedCard) {
        event.preventDefault();
        closeDetail();
      }
    });

    requestLayoutSync();

    document.fonts?.ready
      ?.then(() => {
        requestLayoutSync();
      })
      .catch(() => {});

    requestAnimationFrame(() => {
      root.classList.add('is-ready');
      requestLayoutSync();
    });
  } catch (error) {
    console.error(error);
    status.textContent = 'The transit catalog failed to load.';
    status.classList.add('shell__status--error');
  }
}

async function loadCities() {
  const manifestResponse = await fetch(resolveAssetPath('data/city-manifest.json'));

  if (!manifestResponse.ok) {
    throw new Error('Unable to load city manifest.');
  }

  const manifest = await manifestResponse.json();

  return manifest.sort((left, right) => {
    const regionComparison = CITY_ORDER_COLLATOR.compare(left.region ?? '', right.region ?? '');

    if (regionComparison !== 0) {
      return regionComparison;
    }

    return CITY_ORDER_COLLATOR.compare(left.name, right.name);
  });
}

function resolveAssetPath(relativePath) {
  return new URL(relativePath, document.baseURI).toString();
}

function snapToDevicePixels(value) {
  const devicePixelRatio = window.devicePixelRatio || 1;
  return Math.round(value * devicePixelRatio) / devicePixelRatio;
}

function createCard(city, index, { reducedMotion, interactiveDepth, onOpen }) {
  const theme = getCityTheme(city.slug, index);
  const lineLabel = formatLineLabel(city.lineCount);
  const systemLabel = formatSystemLabel(city);
  const flag = getCountryFlag(city);
  const overviewVariants = Object.fromEntries(
    Object.entries(city.overview?.variants ?? {}).map(([key, variant]) => [
      key,
      variant
        ? {
            ...variant,
            imagePath: variant.imagePath ? resolveAssetPath(variant.imagePath) : null
          }
        : null
    ])
  );
  const detailAsset = city.detail?.imagePath
    ? {
        imagePath: resolveAssetPath(city.detail.imagePath),
        width: city.detail.imageWidth ?? city.detail.width ?? DETAIL_BASE_WIDTH,
        height: city.detail.imageHeight ?? city.detail.height ?? DETAIL_BASE_HEIGHT,
        referenceMarker: city.detail.referenceMarker ?? null
      }
    : null;
  const initialVariantKey =
    overviewVariants[DEFAULT_OVERVIEW_VARIANT]
      ? DEFAULT_OVERVIEW_VARIANT
      : city.overview?.defaultVariant ?? Object.keys(overviewVariants)[0] ?? null;
  const initialOverviewVariant = initialVariantKey ? overviewVariants[initialVariantKey] ?? null : null;
  const referenceArcId = `reference-arc-${city.slug}-${index}`;
  const element = document.createElement('article');
  element.className = 'card';
  element.style.setProperty('--stagger', `${index * 90}ms`);
  element.style.setProperty('--flip-angle', `${index % 2 === 0 ? -12 : 12}deg`);
  element.style.setProperty('--flip-origin', index % 2 === 0 ? '0% 50%' : '100% 50%');
  element.style.setProperty('--hover-shift-x', '0px');
  element.style.setProperty('--hover-shift-y', '0px');
  element.style.setProperty('--hover-rotate-x', '0deg');
  element.style.setProperty('--hover-rotate-y', '0deg');
  element.style.setProperty('--paper-gloss-x', '0px');
  element.style.setProperty('--paper-gloss-y', '0px');
  applyThemeVars(element, theme);
  element.setAttribute('aria-label', `${city.name} transit card`);

  if (!interactiveDepth) {
    element.classList.add('card--static');
  }

  element.innerHTML = `
    <div class="card__stage${interactiveDepth ? '' : ' card__stage--static'}">
      <button type="button" class="card__select" aria-label="Open details for ${city.name}"></button>
      <div class="card__paper${interactiveDepth ? '' : ' card__paper--static'}">
        <div class="card__canvas-frame">
          <div class="card__diagram-shell">
            <div class="card__diagram">
              ${initialOverviewVariant?.imagePath ? `<img class="card__canvas" src="${initialOverviewVariant.imagePath}" alt="" loading="lazy" decoding="async" />` : ''}
              <svg class="card__reference card__reference--circle" aria-hidden="true" focusable="false"></svg>
              <svg class="card__reference card__reference--label" aria-hidden="true" focusable="false"></svg>
            </div>
          </div>
          <div class="card__overlay">
            <p class="card__agency">${systemLabel}</p>
            <h2>${city.name}</h2>
            <p class="card__count">${lineLabel}</p>
          </div>
          ${flag ? `<img class="card__flag" src="${flag.src}" alt="${flag.alt}" loading="lazy" decoding="async" />` : ''}
        </div>
      </div>
    </div>
  `;

  const openButton = element.querySelector('.card__select');
  const canvasFrame = element.querySelector('.card__canvas-frame');
  const diagram = element.querySelector('.card__diagram');
  const overviewImage = element.querySelector('.card__canvas');
  const referenceCircleSvg = element.querySelector('.card__reference--circle');
  const referenceLabelSvg = element.querySelector('.card__reference--label');
  let currentDiagramWidth = 0;
  let currentDiagramHeight = 0;

  function syncDiagramPosition() {
    if (!diagram || !canvasFrame || !currentDiagramWidth || !currentDiagramHeight) {
      return;
    }

    const frameRect = canvasFrame.getBoundingClientRect();

    if (!frameRect.width || !frameRect.height) {
      return;
    }

    const left = snapToDevicePixels((frameRect.width - currentDiagramWidth) / 2);
    const top = snapToDevicePixels((frameRect.height - currentDiagramHeight) / 2);

    diagram.style.setProperty('--diagram-left', `${left}px`);
    diagram.style.setProperty('--diagram-top', `${top}px`);
    diagram.style.setProperty('--diagram-offset-x', '0px');
    diagram.style.setProperty('--diagram-offset-y', '0px');
  }

  function setDiagramPresentation(asset) {
    const width = asset?.width ?? 0;
    const height = asset?.height ?? 0;
    currentDiagramWidth = Math.round(width);
    currentDiagramHeight = Math.round(height);

    if (diagram) {
      diagram.style.setProperty('--diagram-width', `${currentDiagramWidth}px`);
      diagram.style.setProperty('--diagram-height', `${currentDiagramHeight}px`);
    }

    renderReferenceMarker(referenceCircleSvg, referenceLabelSvg, {
      marker: asset?.referenceMarker ?? null,
      width,
      height,
      arcId: referenceArcId
    });

    if (overviewImage && asset?.imagePath) {
      setImageSource(overviewImage, asset.imagePath);
    }

    syncDiagramPosition();
  }

  const card = {
    city,
    theme,
    element,
    systemLabel,
    lineLabel,
    flag,
    detailAsset,
    currentOverviewVariant: initialVariantKey,
    getDetailPresentationAsset() {
      const fallbackVariantKey =
        overviewVariants.close
          ? 'close'
          : this.currentOverviewVariant ?? initialVariantKey;

      return detailAsset ?? overviewVariants[fallbackVariantKey] ?? initialOverviewVariant;
    },
    setOverviewVariant(variantKey) {
      const nextOverviewVariant = overviewVariants[variantKey];

      if (!nextOverviewVariant || variantKey === this.currentOverviewVariant) {
        return;
      }

      this.currentOverviewVariant = variantKey;
      setDiagramPresentation(nextOverviewVariant);
    },
    syncDiagramPosition() {
      syncDiagramPosition();
    },
    setSelected(isSelected, hasSelection) {
      element.classList.toggle('card--selected', isSelected);
      element.classList.toggle('card--muted', hasSelection && !isSelected);
    },
    setHovered(isHovered) {
      if (!interactiveDepth) {
        return;
      }

      element.classList.toggle('card--hovered', isHovered);

      if (!isHovered || reducedMotion) {
        this.resetTilt();
      }
    },
    updateTilt(clientX, clientY) {
      if (!interactiveDepth || reducedMotion) {
        return;
      }

      const rect = element.getBoundingClientRect();

      if (!rect.width || !rect.height) {
        return;
      }

      const xRatio = clamp((clientX - rect.left) / rect.width);
      const yRatio = clamp((clientY - rect.top) / rect.height);
      const xNorm = xRatio * 2 - 1;
      const yNorm = yRatio * 2 - 1;
      const rotateX = -yNorm * 5.2;
      const rotateY = xNorm * 6.8;
      const shiftX = xNorm * 2.2;
      const shiftY = yNorm * 1.4;
      const glossX = xNorm * 5.2;
      const glossY = yNorm * 3;

      element.style.setProperty('--hover-shift-x', `${shiftX.toFixed(2)}px`);
      element.style.setProperty('--hover-shift-y', `${shiftY.toFixed(2)}px`);
      element.style.setProperty('--hover-rotate-x', `${rotateX.toFixed(2)}deg`);
      element.style.setProperty('--hover-rotate-y', `${rotateY.toFixed(2)}deg`);
      element.style.setProperty('--paper-gloss-x', `${glossX.toFixed(2)}px`);
      element.style.setProperty('--paper-gloss-y', `${glossY.toFixed(2)}px`);
    },
    resetTilt() {
      if (!interactiveDepth) {
        return;
      }

      element.style.setProperty('--hover-shift-x', '0px');
      element.style.setProperty('--hover-shift-y', '0px');
      element.style.setProperty('--hover-rotate-x', '0deg');
      element.style.setProperty('--hover-rotate-y', '0deg');
      element.style.setProperty('--paper-gloss-x', '0px');
      element.style.setProperty('--paper-gloss-y', '0px');
    }
  };

  if (overviewImage && initialOverviewVariant?.imagePath) {
    overviewImage.dataset.loadedSrc = initialOverviewVariant.imagePath;
  }

  setDiagramPresentation(initialOverviewVariant);

  if (interactiveDepth) {
    element.addEventListener('pointerenter', (event) => {
      card.setHovered(true);
      card.updateTilt(event.clientX, event.clientY);
    });
    element.addEventListener('pointermove', (event) => {
      card.updateTilt(event.clientX, event.clientY);
    });
    element.addEventListener('pointerleave', () => card.setHovered(false));
    element.addEventListener('pointercancel', () => card.setHovered(false));
    element.addEventListener('focusin', () => card.setHovered(true));
    element.addEventListener('focusout', (event) => {
      if (!element.contains(event.relatedTarget)) {
        card.setHovered(false);
      }
    });
  }

  openButton.addEventListener('click', () => onOpen(card, openButton));

  return card;
}

function createDetailCard(card, { requestId }) {
  const detailPresentation = card.getDetailPresentationAsset();
  const detailWidth = Math.round(detailPresentation?.width ?? DETAIL_BASE_WIDTH);
  const detailHeight = Math.round(detailPresentation?.height ?? DETAIL_BASE_HEIGHT);
  const element = document.createElement('article');
  const flagMarkup = card.flag
    ? `<img class="detail-card__flag" src="${card.flag.src}" alt="${card.flag.alt}" loading="lazy" decoding="async" />`
    : '';

  element.className = 'detail-card';
  applyThemeVars(element, card.theme);
  element.innerHTML = `
    <div class="detail-card__paper">
      <div class="detail-card__canvas-frame">
        <div class="detail-card__viewport-shell">
          <div
            class="detail-card__viewport"
            data-detail-viewport
            tabindex="0"
            role="img"
            aria-label="${card.city.name} transit network diagram. Use wheel or pinch to zoom, drag to pan, and Fit to reset."
          >
            <div class="detail-card__scene" data-detail-scene>
              ${detailPresentation?.imagePath ? `<img class="detail-card__canvas" src="${detailPresentation.imagePath}" alt="" decoding="async" />` : ''}
              <div class="detail-card__fallback-reference">
                <svg class="card__reference card__reference--circle" aria-hidden="true" focusable="false"></svg>
                <svg class="card__reference card__reference--label" aria-hidden="true" focusable="false"></svg>
              </div>
              <div class="detail-card__vector" data-detail-vector aria-hidden="true"></div>
            </div>
          </div>
          <div class="detail-card__viewer-controls" role="group" aria-label="Detail diagram controls">
            <button type="button" class="detail-card__viewer-button" data-detail-zoom-out aria-label="Zoom out detail diagram">
              <span aria-hidden="true">-</span>
            </button>
            <button type="button" class="detail-card__viewer-button detail-card__viewer-button--fit" data-detail-fit>
              Fit
            </button>
            <button type="button" class="detail-card__viewer-button" data-detail-zoom-in aria-label="Zoom in detail diagram">
              <span aria-hidden="true">+</span>
            </button>
            <span class="shell__sr-only" data-detail-zoom-label aria-live="polite">100% zoom</span>
          </div>
        </div>
      </div>
      <div class="detail-card__overlay">
        <p class="detail-card__agency">${card.systemLabel}</p>
        <h2>${card.city.name}</h2>
        <p class="detail-card__count">${card.lineLabel}</p>
      </div>
      ${flagMarkup}
    </div>
  `;

  const viewport = element.querySelector('[data-detail-viewport]');
  const scene = element.querySelector('[data-detail-scene]');
  const detailImage = element.querySelector('.detail-card__canvas');
  const referenceCircleSvg = element.querySelector('.card__reference--circle');
  const referenceLabelSvg = element.querySelector('.card__reference--label');
  const vectorLayer = element.querySelector('[data-detail-vector]');
  const zoomOutButton = element.querySelector('[data-detail-zoom-out]');
  const zoomInButton = element.querySelector('[data-detail-zoom-in]');
  const fitButton = element.querySelector('[data-detail-fit]');
  const zoomLabel = element.querySelector('[data-detail-zoom-label]');
  const pointerState = new Map();
  const state = {
    viewportWidth: 0,
    viewportHeight: 0,
    contentWidth: detailWidth,
    contentHeight: detailHeight,
    zoom: DETAIL_MIN_ZOOM,
    panX: 0,
    panY: 0,
    dragging: false
  };
  let dragState = null;
  let pinchState = null;
  let destroyed = false;
  let resizeObserver = null;

  if (detailImage && detailPresentation?.imagePath) {
    detailImage.dataset.loadedSrc = detailPresentation.imagePath;
  }

  renderReferenceMarker(referenceCircleSvg, referenceLabelSvg, {
    marker: detailPresentation?.referenceMarker ?? null,
    width: detailWidth,
    height: detailHeight,
    arcId: `detail-reference-${card.city.slug}-${requestId}`
  });

  function syncControls() {
    const isAtMinZoom = state.zoom <= DETAIL_MIN_ZOOM + 0.001;
    const isAtMaxZoom = state.zoom >= DETAIL_MAX_ZOOM - 0.001;
    const isAtFit = isAtMinZoom && Math.abs(state.panX) < 0.5 && Math.abs(state.panY) < 0.5;

    zoomOutButton.disabled = isAtMinZoom;
    zoomInButton.disabled = isAtMaxZoom;
    fitButton.disabled = isAtFit;
    zoomLabel.textContent = `${Math.round(state.zoom * 100)}% zoom`;
    element.classList.toggle('detail-card--vector-ready', vectorLayer.childElementCount > 0);
    element.classList.toggle('detail-card--can-pan', state.zoom > DETAIL_MIN_ZOOM + 0.01);
    element.classList.toggle('detail-card--dragging', state.dragging);
  }

  function getFitScale() {
    if (!state.viewportWidth || !state.viewportHeight || !state.contentWidth || !state.contentHeight) {
      return 1;
    }

    return Math.min(state.viewportWidth / state.contentWidth, state.viewportHeight / state.contentHeight);
  }

  function clampPan(nextPanX, nextPanY, zoom = state.zoom) {
    if (!state.viewportWidth || !state.viewportHeight) {
      return { panX: nextPanX, panY: nextPanY };
    }

    const scale = getFitScale() * zoom;
    const scaledWidth = state.contentWidth * scale;
    const scaledHeight = state.contentHeight * scale;
    const gutterX = Math.min(140, state.viewportWidth * DETAIL_PAN_OVERSCROLL_FRACTION);
    const gutterY = Math.min(140, state.viewportHeight * DETAIL_PAN_OVERSCROLL_FRACTION);
    const maxPanX = scaledWidth <= state.viewportWidth ? 0 : Math.max(0, (scaledWidth - state.viewportWidth) / 2 + gutterX);
    const maxPanY = scaledHeight <= state.viewportHeight ? 0 : Math.max(0, (scaledHeight - state.viewportHeight) / 2 + gutterY);

    return {
      panX: clamp(nextPanX, -maxPanX, maxPanX),
      panY: clamp(nextPanY, -maxPanY, maxPanY)
    };
  }

  function syncScene() {
    if (!scene || !state.viewportWidth || !state.viewportHeight) {
      syncControls();
      return;
    }

    const scale = getFitScale() * state.zoom;
    const scaledWidth = state.contentWidth * scale;
    const scaledHeight = state.contentHeight * scale;
    const clampedPan = clampPan(state.panX, state.panY);
    const left = snapToDevicePixels((state.viewportWidth - scaledWidth) / 2 + clampedPan.panX);
    const top = snapToDevicePixels((state.viewportHeight - scaledHeight) / 2 + clampedPan.panY);

    state.panX = clampedPan.panX;
    state.panY = clampedPan.panY;
    scene.style.width = `${scaledWidth}px`;
    scene.style.height = `${scaledHeight}px`;
    scene.style.left = `${left}px`;
    scene.style.top = `${top}px`;
    syncControls();
  }

  function setView(nextZoom, nextPanX = state.panX, nextPanY = state.panY) {
    state.zoom = clamp(nextZoom, DETAIL_MIN_ZOOM, DETAIL_MAX_ZOOM);
    const clampedPan = clampPan(nextPanX, nextPanY, state.zoom);
    state.panX = clampedPan.panX;
    state.panY = clampedPan.panY;
    syncScene();
  }

  function setZoomAroundClientPoint(nextZoom, clientX, clientY, baseZoom = state.zoom, basePanX = state.panX, basePanY = state.panY) {
    if (!viewport || !state.viewportWidth || !state.viewportHeight) {
      setView(nextZoom);
      return;
    }

    const viewportRect = viewport.getBoundingClientRect();
    const anchorX = clamp(clientX - viewportRect.left, 0, viewportRect.width);
    const anchorY = clamp(clientY - viewportRect.top, 0, viewportRect.height);
    const fitScale = getFitScale();
    const currentScale = fitScale * baseZoom;

    if (!currentScale) {
      setView(nextZoom);
      return;
    }

    const resolvedZoom = clamp(nextZoom, DETAIL_MIN_ZOOM, DETAIL_MAX_ZOOM);
    const nextScale = fitScale * resolvedZoom;
    const offsetX = anchorX - viewportRect.width / 2;
    const offsetY = anchorY - viewportRect.height / 2;
    const nextPanX = offsetX - (offsetX - basePanX) * (nextScale / currentScale);
    const nextPanY = offsetY - (offsetY - basePanY) * (nextScale / currentScale);

    setView(resolvedZoom, nextPanX, nextPanY);
  }

  function getViewportCenterClientPoint() {
    if (!viewport) {
      return { clientX: 0, clientY: 0 };
    }

    const viewportRect = viewport.getBoundingClientRect();

    return {
      clientX: viewportRect.left + viewportRect.width / 2,
      clientY: viewportRect.top + viewportRect.height / 2
    };
  }

  function syncViewerLayout() {
    if (!viewport) {
      return;
    }

    const viewportRect = viewport.getBoundingClientRect();

    if (!viewportRect.width || !viewportRect.height) {
      return;
    }

    state.viewportWidth = viewportRect.width;
    state.viewportHeight = viewportRect.height;
    syncScene();
  }

  function setDragStateFromPointer(pointerId, point) {
    if (!point || state.zoom <= DETAIL_MIN_ZOOM + 0.01) {
      dragState = null;
      return;
    }

    dragState = {
      pointerId,
      startClientX: point.clientX,
      startClientY: point.clientY,
      startPanX: state.panX,
      startPanY: state.panY
    };
  }

  function refreshPointerMode() {
    if (pointerState.size >= 2) {
      const [firstPointer, secondPointer] = [...pointerState.entries()];
      const viewportRect = viewport.getBoundingClientRect();
      const firstPoint = firstPointer[1];
      const secondPoint = secondPointer[1];
      const centerX = (firstPoint.clientX + secondPoint.clientX) / 2 - viewportRect.left;
      const centerY = (firstPoint.clientY + secondPoint.clientY) / 2 - viewportRect.top;
      const baseScale = getFitScale() * state.zoom;
      const baseDistance = getPointerDistance(firstPoint, secondPoint);

      dragState = null;
      state.dragging = false;
      pinchState = {
        baseZoom: state.zoom,
        baseDistance: Math.max(baseDistance, 1),
        contentX: baseScale ? (centerX - viewportRect.width / 2 - state.panX) / baseScale : 0,
        contentY: baseScale ? (centerY - viewportRect.height / 2 - state.panY) / baseScale : 0
      };
      syncControls();
      return;
    }

    pinchState = null;
    state.dragging = false;

    if (pointerState.size === 1) {
      const [pointerId, point] = pointerState.entries().next().value;
      setDragStateFromPointer(pointerId, point);
    } else {
      dragState = null;
    }

    syncControls();
  }

  function handlePointerDown(event) {
    if (event.pointerType === 'mouse' && event.button !== 0) {
      return;
    }

    pointerState.set(event.pointerId, { clientX: event.clientX, clientY: event.clientY });
    viewport.setPointerCapture(event.pointerId);
    viewport.focus({ preventScroll: true });
    refreshPointerMode();
    event.preventDefault();
  }

  function handlePointerMove(event) {
    if (!pointerState.has(event.pointerId)) {
      return;
    }

    pointerState.set(event.pointerId, { clientX: event.clientX, clientY: event.clientY });

    if (pinchState && pointerState.size >= 2) {
      const [firstPoint, secondPoint] = [...pointerState.values()];
      const viewportRect = viewport.getBoundingClientRect();
      const centerClientX = (firstPoint.clientX + secondPoint.clientX) / 2;
      const centerClientY = (firstPoint.clientY + secondPoint.clientY) / 2;
      const centerX = centerClientX - viewportRect.left;
      const centerY = centerClientY - viewportRect.top;
      const nextDistance = Math.max(getPointerDistance(firstPoint, secondPoint), 1);
      const nextZoom = clamp(pinchState.baseZoom * (nextDistance / pinchState.baseDistance), DETAIL_MIN_ZOOM, DETAIL_MAX_ZOOM);
      const nextScale = getFitScale() * nextZoom;
      const nextPanX = centerX - viewportRect.width / 2 - pinchState.contentX * nextScale;
      const nextPanY = centerY - viewportRect.height / 2 - pinchState.contentY * nextScale;

      setView(nextZoom, nextPanX, nextPanY);
      event.preventDefault();
      return;
    }

    if (!dragState || dragState.pointerId !== event.pointerId || state.zoom <= DETAIL_MIN_ZOOM + 0.01) {
      return;
    }

    state.dragging = true;
    setView(
      state.zoom,
      dragState.startPanX + (event.clientX - dragState.startClientX),
      dragState.startPanY + (event.clientY - dragState.startClientY)
    );
    event.preventDefault();
  }

  function handlePointerEnd(event) {
    if (!pointerState.has(event.pointerId)) {
      return;
    }

    pointerState.delete(event.pointerId);

    if (viewport.hasPointerCapture(event.pointerId)) {
      viewport.releasePointerCapture(event.pointerId);
    }

    refreshPointerMode();
  }

  function handleWheel(event) {
    if (!state.viewportWidth || !state.viewportHeight) {
      return;
    }

    const nextZoom = clamp(
      state.zoom * Math.exp(-event.deltaY * DETAIL_WHEEL_ZOOM_SENSITIVITY),
      DETAIL_MIN_ZOOM,
      DETAIL_MAX_ZOOM
    );

    if (Math.abs(nextZoom - state.zoom) < 0.001) {
      return;
    }

    setZoomAroundClientPoint(nextZoom, event.clientX, event.clientY);
    event.preventDefault();
  }

  function zoomFromControls(direction) {
    const centerPoint = getViewportCenterClientPoint();
    const nextZoom =
      direction > 0
        ? state.zoom * DETAIL_BUTTON_ZOOM_FACTOR
        : state.zoom / DETAIL_BUTTON_ZOOM_FACTOR;

    setZoomAroundClientPoint(nextZoom, centerPoint.clientX, centerPoint.clientY);
    viewport.focus({ preventScroll: true });
  }

  function handleKeydown(event) {
    if (event.key === '+' || event.key === '=') {
      zoomFromControls(1);
      event.preventDefault();
      return;
    }

    if (event.key === '-' || event.key === '_') {
      zoomFromControls(-1);
      event.preventDefault();
      return;
    }

    if (event.key === '0') {
      setView(DETAIL_MIN_ZOOM, 0, 0);
      event.preventDefault();
    }
  }

  async function loadLiveDiagram(isCurrent) {
    try {
      const detailDiagram = await loadDetailDiagram(card, requestId);

      if (destroyed || !isCurrent()) {
        return;
      }

      state.contentWidth = detailDiagram.width;
      state.contentHeight = detailDiagram.height;
      vectorLayer.innerHTML = detailDiagram.svgMarkup;
      syncScene();
    } catch (error) {
      if (!destroyed && isCurrent()) {
        console.error(error);
      }
    }
  }

  viewport.addEventListener('pointerdown', handlePointerDown);
  viewport.addEventListener('pointermove', handlePointerMove);
  viewport.addEventListener('pointerup', handlePointerEnd);
  viewport.addEventListener('pointercancel', handlePointerEnd);
  viewport.addEventListener('lostpointercapture', handlePointerEnd);
  viewport.addEventListener('wheel', handleWheel, { passive: false });
  viewport.addEventListener('keydown', handleKeydown);
  zoomOutButton.addEventListener('click', () => zoomFromControls(-1));
  zoomInButton.addEventListener('click', () => zoomFromControls(1));
  fitButton.addEventListener('click', () => {
    setView(DETAIL_MIN_ZOOM, 0, 0);
    viewport.focus({ preventScroll: true });
  });

  if (typeof ResizeObserver === 'function') {
    resizeObserver = new ResizeObserver(() => {
      syncViewerLayout();
    });
    resizeObserver.observe(viewport);
  }

  syncControls();

  return {
    requestId,
    element,
    syncViewerLayout,
    loadLiveDiagram,
    destroy() {
      destroyed = true;
      pointerState.clear();
      dragState = null;
      pinchState = null;
      resizeObserver?.disconnect();
    }
  };
}

function updateGridLayout(grid, cardCount, { chromeHeight = 0 } = {}) {
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  const columns = chooseColumnCount(viewportWidth, cardCount);
  const isMobile = viewportWidth < 720;
  const availableHeight = Math.max(320, viewportHeight - chromeHeight);
  const rowTarget =
    columns >= 5 ? 2.16 :
    columns === 4 ? 1.98 :
    columns === 3 ? 1.8 :
    columns === 2 ? 1.56 :
    1.34;
  const cardHeight =
    isMobile
      ? clamp(Math.min(availableHeight * 0.52, viewportWidth * 1.08), 250, 360)
      : clamp(availableHeight / rowTarget, 250, MAX_OVERVIEW_CARD_HEIGHT);

  grid.style.setProperty('--card-columns', String(columns));
  grid.style.setProperty('--card-canvas-height', `${Math.round(cardHeight)}px`);
}

function chooseColumnCount(viewportWidth, cardCount) {
  const minCardWidth = viewportWidth < 720 ? 250 : viewportWidth < 1100 ? 300 : 340;
  const idealCardWidth = viewportWidth >= 1600 ? 420 : viewportWidth >= 1100 ? 390 : 340;
  let best = 1;

  for (let columns = 1; columns <= cardCount; columns += 1) {
    const candidateWidth = viewportWidth / columns;

    if (candidateWidth < minCardWidth) {
      break;
    }

    best = columns;

    if (candidateWidth <= idealCardWidth * 1.08) {
      return columns;
    }
  }

  return best;
}

function formatLineLabel(lineCount) {
  return `${lineCount} ${lineCount === 1 ? 'line' : 'lines'}`;
}

function formatSystemLabel(city) {
  const explicitLabels = {
    atlanta: 'MARTA rail',
    baltimore: 'Metro SubwayLink + Light RailLink',
    chicago: 'Chicago "L"',
    'new-york': 'Subway + Staten Island Railway',
    boston: 'MBTA rapid transit',
    'washington-dc': 'Washington Metro',
    'minneapolis-st-paul': 'Metro light rail',
    seattle: 'Link light rail',
    'los-angeles': 'Metro Rail',
    vancouver: 'SkyTrain',
    edmonton: 'ETS LRT',
    'st-louis': 'MetroLink',
    philadelphia: 'SEPTA Metro + trolley',
    pittsburgh: 'PRT light rail',
    toronto: 'TTC subway + light metro',
    montreal: 'Montreal Metro',
    madrid: 'Metro de Madrid + Metro Ligero',
    stockholm: 'Tunnelbana + Light Rail',
    london: 'Underground + DLR + Overground + Elizabeth',
    'san-francisco-bay-area': 'BART + Muni Metro',
    'san-jose-santa-clara-valley': 'VTA Light Rail + BART'
  };

  if (explicitLabels[city.slug]) {
    return explicitLabels[city.slug];
  }

  return city.sourceName?.replace(/\s*\([^)]+\)/g, '').trim() ?? '';
}

function getCountryFlag(city) {
  const flagCodeByRegion = {
    'United States': 'us',
    Canada: 'ca',
    Mexico: 'mx',
    Spain: 'es',
    Sweden: 'se',
    'United Kingdom': 'gb'
  };

  const code = flagCodeByRegion[city.region];

  if (!code) {
    return null;
  }

  return {
    src: `https://hatscripts.github.io/circle-flags/flags/${code}.svg`,
    alt: `${city.region} flag`
  };
}

function applyThemeVars(element, theme) {
  element.style.setProperty('--card-accent', theme.accent);
  element.style.setProperty('--card-accent-rgb', theme.accentRgb);
  element.style.setProperty('--card-paper', theme.paper);
  element.style.setProperty('--card-paper-strong', theme.paperStrong);
  element.style.setProperty('--card-border', theme.border);
  element.style.setProperty('--card-title', theme.text);
  element.style.setProperty('--card-count', theme.mutedText);
  element.style.setProperty('--card-region', theme.regionText);
  element.style.setProperty('--card-text', theme.text);
  element.style.setProperty('--card-ink', theme.ink);
  element.style.setProperty('--card-reference-fill', theme.referenceFill);
  element.style.setProperty('--card-shadow', theme.shadow);
}

function loadImage(src) {
  if (!src) {
    return Promise.resolve();
  }

  const cached = IMAGE_LOAD_CACHE.get(src);

  if (cached) {
    return cached;
  }

  const pending = new Promise((resolve, reject) => {
    const image = new Image();
    image.decoding = 'async';
    image.onload = () => resolve(src);
    image.onerror = reject;
    image.src = src;

    if (image.complete) {
      resolve(src);
    }
  });

  IMAGE_LOAD_CACHE.set(src, pending);
  return pending;
}

function setImageSource(image, nextSrc) {
  if (!image || !nextSrc || image.dataset.loadedSrc === nextSrc) {
    return;
  }

  image.dataset.pendingSrc = nextSrc;

  loadImage(nextSrc)
    .then(() => {
      if (image.dataset.pendingSrc !== nextSrc) {
        return;
      }

      image.src = nextSrc;
      image.dataset.loadedSrc = nextSrc;
    })
    .catch(() => {
      if (image.dataset.pendingSrc !== nextSrc) {
        return;
      }

      image.src = nextSrc;
      image.dataset.loadedSrc = nextSrc;
    });
}

function loadCityFeatureCollection(city) {
  const cached = CITY_GEOJSON_CACHE.get(city.slug);

  if (cached) {
    return cached;
  }

  const pending = fetch(resolveAssetPath(city.dataPath))
    .then((response) => {
      if (!response.ok) {
        throw new Error(`Unable to load GeoJSON for ${city.slug}.`);
      }

      return response.json();
    })
    .catch((error) => {
      CITY_GEOJSON_CACHE.delete(city.slug);
      throw error;
    });

  CITY_GEOJSON_CACHE.set(city.slug, pending);
  return pending;
}

function loadDetailDiagram(card, requestId) {
  const cached = DETAIL_DIAGRAM_CACHE.get(card.city.slug);

  if (cached) {
    return cached;
  }

  const pending = loadCityFeatureCollection(card.city)
    .then((featureCollection) => {
      const renderCity = {
        ...card.city,
        featureCollection
      };
      const layout = getOverviewDiagramLayout({
        city: renderCity,
        minWidth: DETAIL_BASE_WIDTH,
        minHeight: DETAIL_BASE_HEIGHT,
        diagramScale: DETAIL_DIAGRAM_SCALE,
        planePadding: DETAIL_SAFE_INSET
      });

      return {
        width: layout.width,
        height: layout.height,
        svgMarkup: createOverviewDiagramSvg({
          city: renderCity,
          width: layout.width,
          height: layout.height,
          theme: card.theme,
          idPrefix: `detail-live-${card.city.slug}-${requestId}`,
          includeReferenceMarker: true,
          layout
        })
      };
    })
    .catch((error) => {
      DETAIL_DIAGRAM_CACHE.delete(card.city.slug);
      throw error;
    });

  DETAIL_DIAGRAM_CACHE.set(card.city.slug, pending);
  return pending;
}

function renderReferenceMarker(referenceCircleSvg, referenceLabelSvg, { marker, width, height, arcId }) {
  if (!referenceCircleSvg || !referenceLabelSvg) {
    return;
  }

  if (!marker || !width || !height) {
    referenceCircleSvg.innerHTML = '';
    referenceCircleSvg.setAttribute('hidden', '');
    referenceLabelSvg.innerHTML = '';
    referenceLabelSvg.setAttribute('hidden', '');
    return;
  }

  const startAngle = Math.PI + 0.08;
  const endAngle = Math.PI * 1.5 - 0.08;
  const [arcStartX, arcStartY] = polarToCartesian(marker.centerX, marker.centerY, marker.labelRadius, startAngle);
  const [arcEndX, arcEndY] = polarToCartesian(marker.centerX, marker.centerY, marker.labelRadius, endAngle);
  const arcSweepFlag = endAngle - startAngle <= Math.PI ? 0 : 1;

  referenceCircleSvg.removeAttribute('hidden');
  referenceCircleSvg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  referenceCircleSvg.innerHTML = `
    <circle class="card__reference-circle" cx="${formatSvgNumber(marker.centerX)}" cy="${formatSvgNumber(marker.centerY)}" r="${formatSvgNumber(marker.radius)}"></circle>
  `.trim();

  referenceLabelSvg.removeAttribute('hidden');
  referenceLabelSvg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  referenceLabelSvg.innerHTML = `
    <defs>
      <path id="${arcId}" d="M ${formatSvgNumber(arcStartX)} ${formatSvgNumber(arcStartY)} A ${formatSvgNumber(marker.labelRadius)} ${formatSvgNumber(marker.labelRadius)} 0 ${arcSweepFlag} 1 ${formatSvgNumber(arcEndX)} ${formatSvgNumber(arcEndY)}" />
    </defs>
    <text class="card__reference-label">
      <textPath href="#${arcId}" startOffset="50%" text-anchor="middle">5 MILES</textPath>
    </text>
  `.trim();
}

function polarToCartesian(centerX, centerY, radius, angle) {
  return [
    centerX + Math.cos(angle) * radius,
    centerY + Math.sin(angle) * radius
  ];
}

function formatSvgNumber(value) {
  return Number(value.toFixed(2));
}

function getPointerDistance(left, right) {
  return Math.hypot(right.clientX - left.clientX, right.clientY - left.clientY);
}

function getDetailTargetRect(card) {
  const viewportPadding = window.innerWidth < 720 ? 10 : 24;
  const viewportWidth = card.city.detail?.viewportWidth ?? DETAIL_BASE_WIDTH;
  const viewportHeight = card.city.detail?.viewportHeight ?? DETAIL_BASE_HEIGHT;
  const maxWidth = Math.max(280, Math.min(window.innerWidth - viewportPadding * 2, viewportWidth));
  const maxHeight = Math.max(320, Math.min(window.innerHeight - viewportPadding * 2, viewportHeight));
  const aspectRatio = viewportHeight / viewportWidth;
  let width = maxWidth;
  let height = width * aspectRatio;

  if (height > maxHeight) {
    height = maxHeight;
    width = height / aspectRatio;
  }

  return {
    top: Math.round((window.innerHeight - height) / 2),
    left: Math.round((window.innerWidth - width) / 2),
    width: Math.round(width),
    height: Math.round(height)
  };
}

function applyFixedRect(element, rect) {
  if (!element || !rect) {
    return;
  }

  element.style.position = 'fixed';
  element.style.top = `${Math.round(rect.top)}px`;
  element.style.left = `${Math.round(rect.left)}px`;
  element.style.width = `${Math.round(rect.width)}px`;
  element.style.height = `${Math.round(rect.height)}px`;
  element.style.margin = '0';
  element.style.zIndex = '25';
}

