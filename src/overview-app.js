import { getCityTheme } from './config.js';
import { DEFAULT_OVERVIEW_VARIANT, OVERVIEW_ZOOM_STEPS } from './lib/overview-config.js';
import { clamp } from './lib/math.js';

const CITY_ORDER_COLLATOR = new Intl.Collator('en', { sensitivity: 'base' });

export async function mountApp(root) {
  root.innerHTML = `
    <main class="shell">
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
    </main>
  `;

  const toolbar = root.querySelector('[data-toolbar]');
  const status = root.querySelector('[data-status]');
  const grid = root.querySelector('[data-grid]');
  const zoomLabel = root.querySelector('[data-zoom-label]');
  const zoomSteps = Array.from(root.querySelectorAll('[data-zoom-step]'));
  const zoomOutButton = root.querySelector('[data-zoom-out]');
  const zoomInButton = root.querySelector('[data-zoom-in]');
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  try {
    const cities = await loadCities();
    status.textContent = `${cities.length} metro systems loaded.`;

    const cards = cities.map((city, index) => createCard(city, index, reducedMotion));
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

    zoomOutButton.addEventListener('click', () => setZoomIndex(zoomIndex - 1));
    zoomInButton.addEventListener('click', () => setZoomIndex(zoomIndex + 1));
    window.addEventListener('resize', applyLayout);

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

function createCard(city, index, reducedMotion) {
  const theme = getCityTheme(city.slug, index);
  const lineLabel = formatLineLabel(city.lineCount);
  const systemLabel = formatSystemLabel(city);
  const flag = getCountryFlag(city);
  const defaultVariant = city.overview?.defaultVariant ?? DEFAULT_OVERVIEW_VARIANT;
  const initialOverviewPath = city.overview?.variants?.[defaultVariant];
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
  element.setAttribute('aria-label', `${city.name} transit card`);

  element.innerHTML = `
    <div class="card__stage">
      <div class="card__rotator">
        <section class="card__face card__face--front">
          <button type="button" class="card__select" aria-label="Show back of ${city.name} card"></button>
          <div class="card__paper">
            <div class="card__canvas-frame">
              ${initialOverviewPath ? `<img class="card__canvas" data-overview-image src="${resolveAssetPath(initialOverviewPath)}" alt="" loading="lazy" decoding="async" />` : ''}
              <div class="card__overlay">
                <p class="card__agency">${systemLabel}</p>
                <h2>${city.name}</h2>
                <p class="card__count">${lineLabel}</p>
              </div>
              ${flag ? `<img class="card__flag" src="${flag.src}" alt="${flag.alt}" loading="lazy" decoding="async" />` : ''}
            </div>
          </div>
        </section>
        <section class="card__face card__face--back" aria-hidden="true">
          <button type="button" class="card__select" aria-label="Show front of ${city.name} card"></button>
          <div class="card__paper card__paper--back">
            <div class="card__back-copy">
              <p class="card__back-kicker">Reverse Side</p>
              <h3>Transit notes and stats will live here.</h3>
              <p class="card__back-note">We can use this side for comparisons, system details, and other network context.</p>
              <dl class="card__back-list">
                <div><dt>Coverage</dt><dd>Coming soon</dd></div>
                <div><dt>Stations</dt><dd>Coming soon</dd></div>
                <div><dt>Ridership</dt><dd>Coming soon</dd></div>
              </dl>
            </div>
          </div>
        </section>
      </div>
    </div>
  `;

  const overviewImage = element.querySelector('[data-overview-image]');
  const selectButtons = Array.from(element.querySelectorAll('.card__select'));
  const [frontSelectButton, backSelectButton] = selectButtons;
  const frontFace = element.querySelector('.card__face--front');
  const backFace = element.querySelector('.card__face--back');
  const overviewVariants = city.overview?.variants ?? {};
  const fallbackVariantKey = overviewVariants[DEFAULT_OVERVIEW_VARIANT]
    ? DEFAULT_OVERVIEW_VARIANT
    : Object.keys(overviewVariants)[0] ?? null;
  const card = {
    element,
    flipped: false,
    currentOverviewVariant: initialOverviewPath ? defaultVariant : null,
    setOverviewVariant(variantKey) {
      if (!overviewImage) {
        return;
      }

      const resolvedVariantKey = overviewVariants[variantKey]
        ? variantKey
        : fallbackVariantKey;

      if (!resolvedVariantKey || resolvedVariantKey === this.currentOverviewVariant) {
        return;
      }

      overviewImage.src = resolveAssetPath(overviewVariants[resolvedVariantKey]);
      this.currentOverviewVariant = resolvedVariantKey;
    },
    setFlipped(isFlipped) {
      this.flipped = isFlipped;
      element.classList.toggle('card--flipped', isFlipped);
      frontFace.setAttribute('aria-hidden', String(isFlipped));
      backFace.setAttribute('aria-hidden', String(!isFlipped));
      frontSelectButton.disabled = isFlipped;
      backSelectButton.disabled = !isFlipped;
    },
    setHovered(isHovered) {
      element.classList.toggle('card--hovered', isHovered);

      if (!isHovered || reducedMotion) {
        this.resetTilt();
      }
    },
    updateTilt(clientX, clientY) {
      if (reducedMotion) {
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
      element.style.setProperty('--hover-shift-x', '0px');
      element.style.setProperty('--hover-shift-y', '0px');
      element.style.setProperty('--hover-rotate-x', '0deg');
      element.style.setProperty('--hover-rotate-y', '0deg');
      element.style.setProperty('--paper-gloss-x', '0px');
      element.style.setProperty('--paper-gloss-y', '0px');
    }
  };

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
  frontSelectButton.addEventListener('click', () => card.setFlipped(true));
  backSelectButton.addEventListener('click', () => card.setFlipped(false));
  card.setFlipped(false);

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
