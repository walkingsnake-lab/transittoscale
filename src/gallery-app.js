import { getCityTheme } from './config.js';
import {
  DEFAULT_OVERVIEW_VARIANT,
  DETAIL_BASE_HEIGHT,
  DETAIL_BASE_WIDTH,
  OVERVIEW_ZOOM_STEPS
} from './lib/overview-config.js';
import { clamp } from './lib/math.js';
import { shouldUseSoftHoverEffects, supportsInteractiveDepthEffects } from './lib/platform.js';

const CITY_ORDER_COLLATOR = new Intl.Collator('en', { sensitivity: 'base' });
const IMAGE_LOAD_CACHE = new Map();
const MAX_OVERVIEW_CARD_HEIGHT = 560;
const OVERVIEW_ZOOM_STEP_BY_KEY = new Map(OVERVIEW_ZOOM_STEPS.map((step) => [step.key, step]));

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

      if (selectedCard && detailCard) {
        applyFixedRect(detailCard, getDetailTargetRect(selectedCard));
      }
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
      detailCard = createDetailCard(card);

      const startRect = card.element.getBoundingClientRect();

      showDetailView();
      detailSlot.replaceChildren(detailCard);
      card.setHovered(false);
      card.resetTilt();
      syncSelection();
      applyFixedRect(detailCard, startRect);

      requestAnimationFrame(() => {
        if (!detailCard || selectedCard !== card) {
          return;
        }

        detailView.classList.add('detail-view--open');
        applyFixedRect(detailCard, getDetailTargetRect(card));
      });

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
        detailCard = null;
        selectedCard = null;
        syncSelection();
        detailView.hidden = true;
        detailView.setAttribute('aria-hidden', 'true');
        return;
      }

      detailView.classList.remove('detail-view--open');
      detailView.setAttribute('aria-hidden', 'true');
      applyFixedRect(activeDetailCard, card.element.getBoundingClientRect());

      if (detailHideTimeoutId) {
        window.clearTimeout(detailHideTimeoutId);
      }

      const finalizeClose = () => {
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
    window.addEventListener('resize', applyLayout);
    window.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && selectedCard) {
        event.preventDefault();
        closeDetail();
      }
    });

    requestAnimationFrame(() => {
      root.classList.add('is-ready');
      applyLayout();
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

function createCard(city, index, { reducedMotion, interactiveDepth, onOpen }) {
  const theme = getCityTheme(city.slug, index);
  const lineLabel = formatLineLabel(city.lineCount);
  const systemLabel = formatSystemLabel(city);
  const flag = getCountryFlag(city);
  const overviewAsset = city.overview?.asset
    ? {
        ...city.overview.asset,
        imagePath: city.overview.asset.imagePath ? resolveAssetPath(city.overview.asset.imagePath) : null
      }
    : null;
  const detailAsset = city.detail?.imagePath
    ? {
        imagePath: resolveAssetPath(city.detail.imagePath),
        width: city.detail.imageWidth ?? city.detail.width ?? DETAIL_BASE_WIDTH,
        height: city.detail.imageHeight ?? city.detail.height ?? DETAIL_BASE_HEIGHT,
        referenceMarker: city.detail.referenceMarker ?? null
      }
    : null;
  const initialVariantKey =
    OVERVIEW_ZOOM_STEP_BY_KEY.has(DEFAULT_OVERVIEW_VARIANT)
      ? DEFAULT_OVERVIEW_VARIANT
      : city.overview?.defaultVariant ?? OVERVIEW_ZOOM_STEPS[0]?.key ?? null;
  const initialOverviewZoomStep =
    (initialVariantKey ? OVERVIEW_ZOOM_STEP_BY_KEY.get(initialVariantKey) : null) ??
    OVERVIEW_ZOOM_STEPS[0] ??
    null;
  const overviewBaseDiagramScale = overviewAsset?.diagramScale ?? initialOverviewZoomStep?.diagramScale ?? 1;
  const initialOverviewScaleFactor = initialOverviewZoomStep
    ? initialOverviewZoomStep.diagramScale / overviewBaseDiagramScale
    : 1;
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
              ${overviewAsset?.imagePath ? `<img class="card__canvas" src="${overviewAsset.imagePath}" alt="" loading="lazy" decoding="async" />` : ''}
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
  const diagram = element.querySelector('.card__diagram');
  const overviewImage = element.querySelector('.card__canvas');
  const referenceCircleSvg = element.querySelector('.card__reference--circle');
  const referenceLabelSvg = element.querySelector('.card__reference--label');

  function setDiagramPresentation(asset) {
    const width = asset?.width ?? 0;
    const height = asset?.height ?? 0;

    if (diagram) {
      diagram.style.setProperty('--diagram-width', `${Math.round(width)}px`);
      diagram.style.setProperty('--diagram-height', `${Math.round(height)}px`);
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
  }

  function setOverviewZoomFactor(zoomFactor) {
    if (!diagram) {
      return;
    }

    diagram.style.setProperty('--diagram-scale-factor', zoomFactor.toFixed(4));
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
      return detailAsset ?? overviewAsset;
    },
    setOverviewVariant(variantKey) {
      const nextOverviewZoomStep = OVERVIEW_ZOOM_STEP_BY_KEY.get(variantKey);

      if (!nextOverviewZoomStep || variantKey === this.currentOverviewVariant) {
        return;
      }

      this.currentOverviewVariant = variantKey;
      setOverviewZoomFactor(nextOverviewZoomStep.diagramScale / overviewBaseDiagramScale);
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

  if (overviewImage && overviewAsset?.imagePath) {
    overviewImage.dataset.loadedSrc = overviewAsset.imagePath;
  }

  setDiagramPresentation(overviewAsset);
  setOverviewZoomFactor(initialOverviewScaleFactor);

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

function createDetailCard(card) {
  const detailPresentation = card.getDetailPresentationAsset();
  const element = document.createElement('article');
  const flagMarkup = card.flag
    ? `<img class="detail-card__flag" src="${card.flag.src}" alt="${card.flag.alt}" loading="lazy" decoding="async" />`
    : '';

  element.className = 'detail-card';
  applyThemeVars(element, card.theme);
  element.innerHTML = `
    <div class="detail-card__paper">
      <div class="detail-card__canvas-frame">
        ${detailPresentation?.imagePath ? `<img class="detail-card__canvas" src="${detailPresentation.imagePath}" alt="" decoding="async" />` : ''}
        <svg class="card__reference card__reference--circle" aria-hidden="true" focusable="false"></svg>
        <svg class="card__reference card__reference--label" aria-hidden="true" focusable="false"></svg>
      </div>
      <div class="detail-card__overlay">
        <p class="detail-card__agency">${card.systemLabel}</p>
        <h2>${card.city.name}</h2>
        <p class="detail-card__count">${card.lineLabel}</p>
      </div>
      ${flagMarkup}
    </div>
  `;

  const detailImage = element.querySelector('.detail-card__canvas');
  const referenceCircleSvg = element.querySelector('.card__reference--circle');
  const referenceLabelSvg = element.querySelector('.card__reference--label');

  if (detailImage && detailPresentation?.imagePath) {
    detailImage.dataset.loadedSrc = detailPresentation.imagePath;
  }

  renderReferenceMarker(referenceCircleSvg, referenceLabelSvg, {
    marker: detailPresentation?.referenceMarker ?? null,
    width: detailPresentation?.width ?? 0,
    height: detailPresentation?.height ?? 0,
    arcId: `detail-reference-${card.city.slug}`
  });

  return element;
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

