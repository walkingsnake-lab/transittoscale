import {
  CARD_CANVAS_HEIGHT,
  CARD_PADDING,
  CARD_STYLE,
  FONT_STACK,
  HEADER_OFFSET,
  INTRO_CIRCLE_PORTION,
  INTRO_DURATION_MS,
  INTRO_STAGGER_MS,
  REFERENCE_RADIUS_PIXELS,
  REVEAL_LINE_OFFSET,
  SELECTION_SPRING,
  DIM_SPRING,
  getCityTheme
} from './config.js';
import { clearHiDpiCanvas, buildPathMetrics, drawProgressPath, strokeCircleProgress } from './lib/canvas.js';
import { easeInOutCubic, easeOutCubic } from './lib/easing.js';
import { clamp, damp, invLerp, nearlyEqual } from './lib/math.js';
import { projectFeatureCollection } from './lib/projection.js';

export async function mountApp(root) {
  root.innerHTML = `
    <main class="shell">
      <section class="shell__status" data-status>Loading network catalog…</section>
      <section class="grid" data-grid aria-live="polite"></section>
    </main>
  `;

  const status = root.querySelector('[data-status]');
  const grid = root.querySelector('[data-grid]');
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  status.textContent = 'Loading network catalog...';

  try {
    const cities = await loadCities();
    status.textContent = `${cities.length} metro systems loaded. Select a city to focus the comparison.`;
    const animator = new Animator();
    const cards = cities.map((city, index) => createCard(city, index, animator, reducedMotion, handleSelect));

    cards.forEach(({ element }) => grid.append(element));
    updateGridLayout(grid, cards.length);
    window.addEventListener('resize', () => {
      updateGridLayout(grid, cards.length);
      animator.start();
    });

    requestAnimationFrame(() => {
      root.classList.add('is-ready');
      animator.start();
    });

    let selectedSlug = null;

    function handleSelect(slug) {
      selectedSlug = selectedSlug === slug ? null : slug;
      const hasSelection = selectedSlug !== null;

      for (const card of cards) {
        card.setSelected(card.city.slug === selectedSlug, hasSelection);
      }

      animator.start();
    }
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
  const cities = await Promise.all(
    manifest.map(async (city) => {
      const response = await fetch(resolveAssetPath(city.dataPath));

      if (!response.ok) {
        throw new Error(`Unable to load ${city.slug}.`);
      }

      return {
        ...city,
        geojson: await response.json()
      };
    })
  );

  return cities;
}

function resolveAssetPath(relativePath) {
  return new URL(relativePath, document.baseURI).toString();
}

function createCard(city, index, animator, reducedMotion, onSelect) {
  const theme = getCityTheme(city.slug, index);
  const element = document.createElement('button');
  element.type = 'button';
  element.className = 'card';
  element.style.setProperty('--stagger', `${index * INTRO_STAGGER_MS}ms`);
  element.style.setProperty('--flip-angle', `${index % 2 === 0 ? -12 : 12}deg`);
  element.style.setProperty('--flip-origin', index % 2 === 0 ? '0% 50%' : '100% 50%');
  element.style.setProperty('--card-accent', theme.accent);
  element.style.setProperty('--card-accent-rgb', theme.accentRgb);
  element.style.setProperty('--card-surface', theme.surface);
  element.style.setProperty('--card-surface-strong', theme.surfaceStrong);
  element.style.setProperty('--card-border', theme.border);
  element.style.setProperty('--card-overlay-fill', theme.overlayFill);
  element.style.setProperty('--card-title', theme.accent);
  element.style.setProperty('--card-count', theme.accent);
  element.style.setProperty('--card-region', theme.regionText);
  element.style.setProperty('--card-text', theme.text);
  element.setAttribute('aria-pressed', 'false');

  element.innerHTML = `
    <div class="card__canvas-frame">
      <canvas class="card__canvas"></canvas>
      <div class="card__overlay">
        <div>
          <p class="card__region">${city.region}</p>
          <h2>${city.name}</h2>
        </div>
        <p class="card__count">${city.lineCount} lines</p>
      </div>
    </div>
  `;

  const canvas = element.querySelector('canvas');
  const frame = element.querySelector('.card__canvas-frame');
  const ctx = canvas.getContext('2d');
  const observer = new ResizeObserver(() => {
    card.resize();
    animator.start();
  });

  const card = {
    city,
    theme,
    element,
    canvas,
    ctx,
    width: 0,
    height: CARD_CANVAS_HEIGHT,
    projectedLines: [],
    selectedValue: 0,
    selectedTarget: 0,
    dimValue: 0,
    dimTarget: 0,
    introStart: performance.now() + index * INTRO_STAGGER_MS,
    introValue: reducedMotion ? 1 : 0,
    active: true,
    resize() {
      const width = Math.max(220, Math.round(frame.clientWidth));
      const height = Math.max(220, Math.round(frame.clientHeight || CARD_CANVAS_HEIGHT));
      this.width = width;
      this.height = height;
      clearHiDpiCanvas(canvas, ctx, width, height, window.devicePixelRatio || 1);
      this.projectedLines = projectLines(city, width, height);
      this.draw();
    },
    setSelected(isSelected, hasSelection) {
      this.selectedTarget = isSelected ? 1 : 0;
      this.dimTarget = hasSelection && !isSelected ? 1 : 0;
      element.classList.toggle('card--selected', isSelected);
      element.classList.toggle('card--muted', hasSelection && !isSelected);
      element.setAttribute('aria-pressed', String(isSelected));
      this.active = true;
    },
    update(now, deltaSeconds) {
      let stillAnimating = false;

      if (!reducedMotion && this.introValue < 1) {
        this.introValue = clamp((now - this.introStart) / INTRO_DURATION_MS);
        stillAnimating = stillAnimating || this.introValue < 1;
      } else {
        this.introValue = 1;
      }

      const nextSelected = damp(this.selectedValue, this.selectedTarget, SELECTION_SPRING, deltaSeconds);
      const nextDim = damp(this.dimValue, this.dimTarget, DIM_SPRING, deltaSeconds);

      stillAnimating =
        stillAnimating ||
        !nearlyEqual(nextSelected, this.selectedTarget) ||
        !nearlyEqual(nextDim, this.dimTarget);

      this.selectedValue = nextSelected;
      this.dimValue = nextDim;

      if (stillAnimating || this.active) {
        this.draw(now);
      }

      this.active = false;
      return stillAnimating;
    },
    draw() {
      drawCard({
        ctx,
        width: this.width,
        height: this.height,
        projectedLines: this.projectedLines,
        theme: this.theme,
        introValue: this.introValue,
        selectedValue: this.selectedValue,
        dimValue: this.dimValue
      });
    }
  };

  element.addEventListener('click', () => onSelect(city.slug));
  observer.observe(frame);
  card.resize();
  animator.add(card);

  return card;
}

function updateGridLayout(grid, cardCount) {
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  const columns = chooseColumnCount(viewportWidth, cardCount);
  const rowTarget =
    columns >= 5 ? 2.2 :
    columns === 4 ? 2 :
    columns === 3 ? 1.8 :
    columns === 2 ? 1.55 :
    1.35;
  const cardHeight = clamp(viewportHeight / rowTarget, 320, 620);

  grid.style.setProperty('--card-columns', String(columns));
  grid.style.setProperty('--card-canvas-height', `${Math.round(cardHeight)}px`);
}

function chooseColumnCount(viewportWidth, cardCount) {
  const minCardWidth = viewportWidth < 720 ? 220 : 260;
  const idealCardWidth = viewportWidth >= 1600 ? 360 : viewportWidth >= 1100 ? 340 : 315;
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

function projectLines(city, width, height) {
  const frameWidth = width - CARD_PADDING * 2;
  const frameHeight = height - CARD_PADDING * 2 - HEADER_OFFSET;
  const centerX = CARD_PADDING + frameWidth / 2;
  const centerY = CARD_PADDING + HEADER_OFFSET + frameHeight / 2;
  const anchorPoint = city.focusPoint ?? city.centroid;
  const projectedFeatures = projectFeatureCollection(city.geojson, anchorPoint);

  return projectedFeatures.map((feature) => ({
    ...feature,
    paths: feature.paths
      .map((path) => path.map(([x, y]) => [centerX + x, centerY + y]))
      .map((translatedPath) => buildPathMetrics(translatedPath))
  }));
}

function drawCard({
  ctx,
  width,
  height,
  projectedLines,
  theme,
  introValue,
  selectedValue,
  dimValue
}) {
  ctx.clearRect(0, 0, width, height);

  const revealValue = easeOutCubic(introValue);
  const circleValue = easeInOutCubic(invLerp(revealValue, 0, INTRO_CIRCLE_PORTION));
  const lineWindow = invLerp(revealValue, 0.18, 1);
  const emphasis = selectedValue;
  const dimmed = dimValue;

  ctx.save();
  ctx.strokeStyle = theme.cardStroke;
  ctx.lineWidth = 1;
  ctx.strokeRect(0.5, 0.5, width - 1, height - 1);
  ctx.restore();

  if (emphasis > 0.01) {
    ctx.save();
    ctx.fillStyle = theme.selectedGlow;
    ctx.fillRect(0, 0, width, height);
    ctx.restore();
  }

  const circleCenterX = width / 2;
  const circleCenterY = height / 2;

  ctx.save();
  ctx.strokeStyle = theme.referenceStroke;
  ctx.globalAlpha = 0.28 + emphasis * 0.18 - dimmed * 0.1;
  ctx.lineWidth = 1.1;
  strokeCircleProgress(ctx, circleCenterX, circleCenterY, REFERENCE_RADIUS_PIXELS, circleValue);
  ctx.fillStyle = theme.referenceStroke;
  ctx.font = `600 11px ${FONT_STACK}`;
  ctx.textAlign = 'center';
  ctx.fillText('5 mi', circleCenterX, circleCenterY + REFERENCE_RADIUS_PIXELS + 16);
  ctx.restore();

  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = CARD_STYLE.lineStroke;
  ctx.globalAlpha = CARD_STYLE.baseAlpha * (1 - dimmed) + CARD_STYLE.dimmedAlpha * dimmed;
  ctx.lineWidth =
    CARD_STYLE.baseLineWidth +
    (CARD_STYLE.selectedLineWidth - CARD_STYLE.baseLineWidth) * emphasis;

  const lineCount = projectedLines.length;

  projectedLines.forEach((line, index) => {
    const offset = lineCount > 1 ? (index / lineCount) * REVEAL_LINE_OFFSET * lineCount : 0;
    const progress = easeOutCubic(clamp((lineWindow - offset) / Math.max(0.12, 1 - offset)));

    for (const metrics of line.paths) {
      drawProgressPath(ctx, metrics, progress);
    }
  });

  ctx.restore();

  if (emphasis > 0.01) {
    ctx.save();
    ctx.strokeStyle = theme.selectedCardStroke;
    ctx.globalAlpha = emphasis;
    ctx.lineWidth = 1.5;
    ctx.strokeRect(1, 1, width - 2, height - 2);
    ctx.restore();
  }
}

class Animator {
  constructor() {
    this.items = new Set();
    this.rafId = 0;
    this.lastFrame = 0;
  }

  add(item) {
    this.items.add(item);
  }

  start() {
    if (this.rafId) {
      return;
    }

    this.rafId = requestAnimationFrame((time) => this.tick(time));
  }

  tick(now) {
    const deltaSeconds = this.lastFrame ? Math.min(0.1, (now - this.lastFrame) / 1000) : 1 / 60;
    this.lastFrame = now;

    let keepRunning = false;

    for (const item of this.items) {
      keepRunning = item.update(now, deltaSeconds) || keepRunning;
    }

    if (keepRunning) {
      this.rafId = requestAnimationFrame((time) => this.tick(time));
    } else {
      this.rafId = 0;
      this.lastFrame = 0;
    }
  }
}
