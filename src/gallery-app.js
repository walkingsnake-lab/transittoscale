import { getCityTheme } from './config.js';
import { DEFAULT_OVERVIEW_VARIANT, OVERVIEW_ZOOM_STEPS } from './lib/overview-config.js';
import { clamp } from './lib/math.js';

const CITY_ORDER_COLLATOR = new Intl.Collator('en', { sensitivity: 'base' });
const IMAGE_LOAD_CACHE = new Map();

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
        <article class="detail-card" data-detail-card role="dialog" aria-modal="true" aria-label="Selected transit system detail">
          <button type="button" class="detail-card__close" data-detail-close aria-label="Close selected transit system">
            <span aria-hidden="true">&times;</span>
          </button>
          <div class="detail-card__paper">
            <div class="detail-card__canvas-frame">
              <img class="detail-card__canvas" data-detail-image alt="" decoding="async" />
              <div class="detail-card__overlay">
                <p class="detail-card__agency" data-detail-agency></p>
                <h2 data-detail-title></h2>
                <p class="detail-card__count" data-detail-count></p>
              </div>
              <img class="detail-card__flag" data-detail-flag alt="" decoding="async" hidden />
            </div>
          </div>
        </article>
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
  const detailCard = root.querySelector('[data-detail-card]');
  const detailBackdrop = root.querySelector('[data-detail-backdrop]');
  const detailCloseButton = root.querySelector('[data-detail-close]');
  const detailImage = root.querySelector('[data-detail-image]');
  const detailAgency = root.querySelector('[data-detail-agency]');
  const detailTitle = root.querySelector('[data-detail-title]');
  const detailCount = root.querySelector('[data-detail-count]');
  const detailFlag = root.querySelector('[data-detail-flag]');
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const interactiveDepth = !reducedMotion && supportsInteractiveDepthEffects();
  let selectedCard = null;
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
          if (selectedCard === card) {
            closeDetail();
            return;
          }

          selectedCard = card;
          lastActiveTrigger = triggerElement;
          populateDetail(card);
          syncSelection();
          showDetailView();
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

    function populateDetail(card) {
      const { city, theme } = card;
      const flag = getCountryFlag(city);
      const detailImagePath =
        city.detail?.imagePath ??
        city.overview?.variants?.close ??
        city.overview?.variants?.[DEFAULT_OVERVIEW_VARIANT] ??
        null;

      applyThemeVars(detailCard, theme);
      detailCard.setAttribute('aria-label', `${city.name} transit system detail`);
      detailAgency.textContent = formatSystemLabel(city);
      detailTitle.textContent = city.name;
      detailCount.textContent = formatLineLabel(city.lineCount);

      if (detailImagePath) {
        setImageSource(detailImage, resolveAssetPath(detailImagePath));
      } else {
        detailImage.removeAttribute('src');
        delete detailImage.dataset.loadedSrc;
        delete detailImage.dataset.pendingSrc;
      }

      if (flag) {
        detailFlag.src = flag.src;
        detailFlag.alt = flag.alt;
        detailFlag.hidden = false;
      } else {
        detailFlag.hidden = true;
        detailFlag.removeAttribute('src');
        detailFlag.alt = '';
      }
    }

    function showDetailView() {
      if (detailHideTimeoutId) {
        window.clearTimeout(detailHideTimeoutId);
        detailHideTimeoutId = 0;
      }

      detailView.hidden = false;
      detailView.setAttribute('aria-hidden', 'false');
      requestAnimationFrame(() => {
        detailView.classList.add('detail-view--open');
      });
      detailCloseButton.focus({ preventScroll: true });
    }

    function closeDetail() {
      if (!selectedCard && detailView.hidden) {
        return;
      }

      const focusTarget = lastActiveTrigger;

      selectedCard = null;
      syncSelection();
      detailView.classList.remove('detail-view--open');
      detailView.setAttribute('aria-hidden', 'true');

      if (detailHideTimeoutId) {
        window.clearTimeout(detailHideTimeoutId);
      }

      detailHideTimeoutId = window.setTimeout(() => {
        if (!selectedCard) {
          detailView.hidden = true;
        }

        detailHideTimeoutId = 0;
      }, 260);

      if (focusTarget instanceof HTMLElement) {
        requestAnimationFrame(() => {
          focusTarget.focus({ preventScroll: true });
        });
      }
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

function supportsInteractiveDepthEffects() {
  return window.matchMedia('(hover: hover) and (pointer: fine)').matches;
}

function createCard(city, index, { reducedMotion, interactiveDepth, onOpen }) {
  const theme = getCityTheme(city.slug, index);
  const lineLabel = formatLineLabel(city.lineCount);
  const systemLabel = formatSystemLabel(city);
  const flag = getCountryFlag(city);
  const overviewVariantPaths = Object.fromEntries(
    Object.entries(city.overview?.variants ?? {}).map(([key, relativePath]) => [key, resolveAssetPath(relativePath)])
  );
  const initialVariantKey =
    overviewVariantPaths[DEFAULT_OVERVIEW_VARIANT]
      ? DEFAULT_OVERVIEW_VARIANT
      : city.overview?.defaultVariant ?? Object.keys(overviewVariantPaths)[0] ?? null;
  const initialOverviewPath = initialVariantKey ? overviewVariantPaths[initialVariantKey] : null;
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
          ${initialOverviewPath ? `<img class="card__canvas" src="${initialOverviewPath}" alt="" loading="lazy" decoding="async" />` : ''}
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
  const overviewImage = element.querySelector('.card__canvas');
  const card = {
    city,
    theme,
    element,
    currentOverviewVariant: initialVariantKey,
    setOverviewVariant(variantKey) {
      const nextOverviewPath = overviewVariantPaths[variantKey];

      if (!overviewImage || !nextOverviewPath || variantKey === this.currentOverviewVariant) {
        return;
      }

      setImageSource(overviewImage, nextOverviewPath);
      this.currentOverviewVariant = variantKey;
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

  if (overviewImage && initialOverviewPath) {
    overviewImage.dataset.loadedSrc = initialOverviewPath;
  }

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
      : clamp(availableHeight / rowTarget, 250, 500);

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
    toronto: 'TTC subway + light metro',
    montreal: 'Montreal Metro',
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

