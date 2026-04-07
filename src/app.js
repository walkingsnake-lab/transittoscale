import {
  CARD_CANVAS_HEIGHT,
  CARD_PADDING,
  CARD_STYLE,
  FONT_STACK_TIGHT,
  HEADER_OFFSET,
  INTRO_STAGGER_MS,
  REFERENCE_RADIUS_PIXELS,
  SELECTION_SPRING,
  DIM_SPRING,
  HOVER_SPRING,
  getCityTheme
} from './config.js';
import {
  clearHiDpiCanvas,
  buildPathMetrics,
  simplifyPath
} from './lib/canvas.js';
import { createCityDisplay } from './lib/display-profiles.js';
import { clamp, damp, nearlyEqual } from './lib/math.js';
import { projectFeatureCollection } from './lib/projection.js';

const ZOOM_STEPS = [
  { label: 'Wide', diagramScale: 0.82 },
  { label: 'Standard', diagramScale: 1 },
  { label: 'Close', diagramScale: 1.18 }
];
const DIAGRAM_ZOOM_SPRING = 10;
const CITY_ORDER_COLLATOR = new Intl.Collator('en', { sensitivity: 'base' });
const SEGMENT_SNAP_PRECISION = 0.1;
const MIN_SEGMENT_DUPLICATE_SHARE = 0.15;
const CORRIDOR_SIGNATURE_PRECISION = 1.25;
const CORRIDOR_LENGTH_PRECISION = 1.5;
const CORRIDOR_ENDPOINT_PRECISION = 0.45;
const CORRIDOR_ANGLE_BUCKETS = 18;
const MIN_CORRIDOR_COLLAPSE_SHARE = 0.12;

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
      <section class="shell__status" data-status>Loading network catalog…</section>
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
  status.textContent = 'Loading network catalog...';

  try {
    const cities = await loadCities();
    status.textContent = `${cities.length} metro systems loaded. Select a city to focus the comparison.`;
    const animator = new Animator();
    const cards = cities.map((city, index) => createCard(city, index, animator, reducedMotion, handleSelect));

    cards.forEach(({ element }) => grid.append(element));

    let zoomIndex = 1;

    function syncZoomControls() {
      const zoomStep = ZOOM_STEPS[zoomIndex];

      zoomLabel.textContent = zoomStep.label;
      zoomSteps.forEach((step, index) => step.classList.toggle('zoom-controls__step--active', index === zoomIndex));
      zoomOutButton.disabled = zoomIndex === 0;
      zoomInButton.disabled = zoomIndex === ZOOM_STEPS.length - 1;
      cards.forEach((card) => card.setDiagramScale(zoomStep.diagramScale));
      animator.start();
    }

    function applyLayout() {
      const chromeHeight = toolbar ? Math.ceil(toolbar.getBoundingClientRect().height) + 18 : 0;

      updateGridLayout(grid, cards.length, { chromeHeight });
      cards.forEach((card) => card.resize());
      syncZoomControls();
    }

    function setZoomIndex(nextZoomIndex) {
      const boundedZoomIndex = clamp(nextZoomIndex, 0, ZOOM_STEPS.length - 1);

      if (boundedZoomIndex === zoomIndex) {
        return;
      }

      zoomIndex = boundedZoomIndex;
      applyLayout();
    }

    zoomOutButton.addEventListener('click', () => setZoomIndex(zoomIndex - 1));
    zoomInButton.addEventListener('click', () => setZoomIndex(zoomIndex + 1));
    window.addEventListener('resize', applyLayout);

    requestAnimationFrame(() => {
      root.classList.add('is-ready');
      applyLayout();
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

  return cities.sort((left, right) => {
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

function createCard(city, index, animator, reducedMotion, onSelect) {
  const display = city.display ?? createCityDisplay(city.displayProfile, city.lineCount);
  const theme = getCityTheme(city.slug, index);
  const lineLabel = formatLineLabel(city.lineCount);
  const systemLabel = formatSystemLabel(city);
  const flag = getCountryFlag(city);
  const element = document.createElement('article');
  element.className = 'card';
  element.style.setProperty('--stagger', `${index * INTRO_STAGGER_MS}ms`);
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
              <canvas class="card__canvas"></canvas>
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

  const stage = element.querySelector('.card__stage');
  const canvas = element.querySelector('canvas');
  const frame = element.querySelector('.card__canvas-frame');
  const selectButtons = Array.from(element.querySelectorAll('.card__select'));
  const [frontSelectButton, backSelectButton] = selectButtons;
  const frontFace = element.querySelector('.card__face--front');
  const backFace = element.querySelector('.card__face--back');
  const ctx = canvas.getContext('2d');
  const observer = new ResizeObserver(() => {
    card.resize();
    animator.start();
  });

  const card = {
    city: {
      ...city,
      display
    },
    theme,
    element,
    canvas,
    ctx,
    width: 0,
    height: CARD_CANVAS_HEIGHT,
    projectedLines: [],
    diagramScaleValue: 1,
    diagramScaleTarget: 1,
    selectedValue: 0,
    selectedTarget: 0,
    hoverValue: 0,
    hoverTarget: 0,
    dimValue: 0,
    dimTarget: 0,
    flipped: false,
    active: true,
    resize() {
      const width = Math.max(220, Math.round(stage.clientWidth));
      const height = Math.max(220, Math.round(stage.clientHeight || CARD_CANVAS_HEIGHT));
      this.width = width;
      this.height = height;
      clearHiDpiCanvas(canvas, ctx, width, height, window.devicePixelRatio || 1);
      this.projectedLines = projectLines(this.city, width, height);
      this.draw();
    },
    setDiagramScale(diagramScale) {
      this.diagramScaleTarget = diagramScale;

      if (reducedMotion) {
        this.diagramScaleValue = diagramScale;
      }

      this.active = true;
    },
    setSelected(isSelected, hasSelection) {
      this.selectedTarget = isSelected ? 1 : 0;
      this.dimTarget = hasSelection && !isSelected ? 1 : 0;
      element.classList.toggle('card--selected', isSelected);
      element.classList.toggle('card--muted', hasSelection && !isSelected);
      this.active = true;
    },
    setFlipped(isFlipped) {
      this.flipped = isFlipped;
      element.classList.toggle('card--flipped', isFlipped);
      frontFace.setAttribute('aria-hidden', String(isFlipped));
      backFace.setAttribute('aria-hidden', String(!isFlipped));
      frontSelectButton.disabled = isFlipped;
      backSelectButton.disabled = !isFlipped;
      this.active = true;
    },
    toggleFlipped() {
      this.setFlipped(!this.flipped);
    },
    setHovered(isHovered) {
      this.hoverTarget = isHovered ? 1 : 0;
      element.classList.toggle('card--hovered', isHovered);

      if (!isHovered || reducedMotion) {
        this.resetTilt();
      }

      this.active = true;
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
    },
    update(now, deltaSeconds) {
      let stillAnimating = false;

      const nextSelected = damp(this.selectedValue, this.selectedTarget, SELECTION_SPRING, deltaSeconds);
      const nextHover = damp(this.hoverValue, this.hoverTarget, HOVER_SPRING, deltaSeconds);
      const nextDim = damp(this.dimValue, this.dimTarget, DIM_SPRING, deltaSeconds);
      const nextDiagramScale = reducedMotion
        ? this.diagramScaleTarget
        : damp(this.diagramScaleValue, this.diagramScaleTarget, DIAGRAM_ZOOM_SPRING, deltaSeconds);

      stillAnimating =
        stillAnimating ||
        !nearlyEqual(nextSelected, this.selectedTarget) ||
        !nearlyEqual(nextHover, this.hoverTarget) ||
        !nearlyEqual(nextDim, this.dimTarget) ||
        !nearlyEqual(nextDiagramScale, this.diagramScaleTarget);

      this.selectedValue = nextSelected;
      this.hoverValue = nextHover;
      this.dimValue = nextDim;
      this.diagramScaleValue = nextDiagramScale;

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
        diagramScale: this.diagramScaleValue,
        display: this.city.display,
        theme: this.theme,
        selectedValue: this.selectedValue,
        hoverValue: this.hoverValue,
        dimValue: this.dimValue
      });
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
  observer.observe(stage);
  card.setFlipped(false);
  card.resize();
  animator.add(card);

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
  const baseCardHeight =
    isMobile
      ? clamp(Math.min(availableHeight * 0.52, viewportWidth * 1.08), 250, 360)
      : clamp(availableHeight / rowTarget, 250, 500);
  const cardHeight = baseCardHeight;

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

function projectLines(city, width, height) {
  const frameWidth = width - CARD_PADDING * 2;
  const frameHeight = height - CARD_PADDING * 2 - HEADER_OFFSET;
  const centerX = CARD_PADDING + frameWidth / 2;
  const centerY = CARD_PADDING + HEADER_OFFSET + frameHeight / 2;
  const anchorPoint = city.focusPoint ?? city.centroid;
  const projectedFeatures = projectFeatureCollection(city.geojson, anchorPoint);
  const projectedPaths = projectedFeatures.flatMap((feature) =>
    feature.paths
      .map((path) => path.map(([x, y]) => [centerX + x, centerY + y]))
      .map((translatedPath) => simplifyPath(translatedPath, city.display.simplifyTolerance))
      .filter((path) => path.length > 1)
  );
  const { mergedPaths, duplicateShare } = mergeOverlappingPaths(projectedPaths);
  let displayPaths = duplicateShare >= MIN_SEGMENT_DUPLICATE_SHARE ? mergedPaths : projectedPaths;
  const shouldCollapseCorridors = city.display.profile !== 'standard' || city.lineCount >= 8;

  if (shouldCollapseCorridors) {
    const { collapsedPaths, collapseShare } = collapseNearbyCorridors(displayPaths);

    if (collapseShare >= MIN_CORRIDOR_COLLAPSE_SHARE) {
      displayPaths = collapsedPaths;
    }
  }

  return displayPaths
    .map((path) => buildPathMetrics(path))
    .filter((metrics) => metrics.totalLength > 0)
    .sort((left, right) => right.totalLength - left.totalLength);
}

function drawCard({
  ctx,
  width,
  height,
  projectedLines,
  diagramScale,
  display,
  theme,
  selectedValue,
  hoverValue,
  dimValue
}) {
  ctx.clearRect(0, 0, width, height);

  const emphasis = selectedValue;
  const hover = hoverValue;
  const dimmed = dimValue;

  if (emphasis > 0.01) {
    ctx.save();
    ctx.fillStyle = theme.selectedGlow;
    ctx.fillRect(0, 0, width, height);
    ctx.restore();
  }

  const circleCenterX = width / 2;
  const circleCenterY = height / 2;
  const referenceRadius = REFERENCE_RADIUS_PIXELS * diagramScale;
  const circleAlpha = clamp(0.24 + hover * 0.14 + emphasis * 0.07 - dimmed * 0.06, 0.08, 0.46);

  ctx.save();
  ctx.fillStyle = theme.referenceFill;
  ctx.globalAlpha = circleAlpha;
  ctx.beginPath();
  ctx.arc(circleCenterX, circleCenterY, referenceRadius, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  drawArcLabel(ctx, {
    text: '5 MILES',
    centerX: circleCenterX,
    centerY: circleCenterY,
    radius: referenceRadius + 10,
    startAngle: Math.PI + 0.08,
    endAngle: Math.PI * 1.5 - 0.08,
    fillStyle: theme.referenceFill,
    font: `800 15px ${FONT_STACK_TIGHT}`,
    letterSpacing: 0.9,
    globalAlpha: clamp(circleAlpha * (0.92 + hover * 0.2 + emphasis * 0.08 - dimmed * 0.08), 0.08, 0.34)
  });

  ctx.save();
  const emphasisStrength = Math.max(emphasis, hover * 0.65);
  const baseLineWidth = CARD_STYLE.baseLineWidth;
  const selectedLineWidth = CARD_STYLE.selectedLineWidth;
  const lineWidth = baseLineWidth + (selectedLineWidth - baseLineWidth) * emphasisStrength;
  const scaleSafe = Math.max(diagramScale, 0.001);
  const scaledLineWidth = lineWidth / scaleSafe;

  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.imageSmoothingEnabled = true;
  ctx.translate(circleCenterX, circleCenterY);
  ctx.scale(diagramScale, diagramScale);
  ctx.translate(-circleCenterX, -circleCenterY);

  ctx.strokeStyle = theme.ink;
  // Keep shared corridors from compounding into visibly darker knots.
  ctx.globalCompositeOperation = 'darken';
  ctx.globalAlpha = display.lineAlpha * (1 - dimmed) + CARD_STYLE.dimmedAlpha * dimmed;
  ctx.lineWidth = scaledLineWidth;
  drawProjectedLines(ctx, projectedLines);

  ctx.restore();
}

function drawProjectedLines(ctx, projectedLines) {
  projectedLines.forEach((metrics) => {
    ctx.beginPath();
    ctx.moveTo(metrics.points[0][0], metrics.points[0][1]);

    for (let index = 1; index < metrics.points.length; index += 1) {
      ctx.lineTo(metrics.points[index][0], metrics.points[index][1]);
    }

    ctx.stroke();
  });
}

function mergeOverlappingPaths(paths, snapPrecision = SEGMENT_SNAP_PRECISION) {
  const pointByKey = new Map();
  const segmentByKey = new Map();
  const adjacency = new Map();
  let totalSegmentCount = 0;

  for (const path of paths) {
    for (let index = 1; index < path.length; index += 1) {
      totalSegmentCount += 1;
      const startPoint = path[index - 1];
      const endPoint = path[index];
      const startKey = getSnappedPointKey(startPoint, pointByKey, snapPrecision);
      const endKey = getSnappedPointKey(endPoint, pointByKey, snapPrecision);

      if (startKey === endKey) {
        continue;
      }

      const segmentKey = startKey < endKey ? `${startKey}|${endKey}` : `${endKey}|${startKey}`;

      if (segmentByKey.has(segmentKey)) {
        continue;
      }

      segmentByKey.set(segmentKey, { startKey, endKey });
      addAdjacency(adjacency, startKey, segmentKey);
      addAdjacency(adjacency, endKey, segmentKey);
    }
  }

  const unusedSegmentKeys = new Set(segmentByKey.keys());
  const mergedPaths = [];

  for (const [pointKey, connectedSegmentKeys] of adjacency.entries()) {
    if (connectedSegmentKeys.size === 2) {
      continue;
    }

    for (const segmentKey of connectedSegmentKeys) {
      if (!unusedSegmentKeys.has(segmentKey)) {
        continue;
      }

      mergedPaths.push(walkMergedPath(pointKey, segmentKey, unusedSegmentKeys, adjacency, segmentByKey, pointByKey));
    }
  }

  for (const segmentKey of [...unusedSegmentKeys]) {
    const segment = segmentByKey.get(segmentKey);
    mergedPaths.push(
      walkMergedPath(segment.startKey, segmentKey, unusedSegmentKeys, adjacency, segmentByKey, pointByKey)
    );
  }

  return {
    mergedPaths: mergedPaths.filter((path) => path.length > 1),
    duplicateShare: totalSegmentCount > 0 ? 1 - segmentByKey.size / totalSegmentCount : 0
  };
}

function collapseNearbyCorridors(paths) {
  const corridorGroups = new Map();
  let totalSegmentCount = 0;

  for (const path of paths) {
    for (let index = 1; index < path.length; index += 1) {
      let start = path[index - 1];
      let end = path[index];

      if (!start || !end) {
        continue;
      }

      if (end[0] < start[0] || (end[0] === start[0] && end[1] < start[1])) {
        [start, end] = [end, start];
      }

      const dx = end[0] - start[0];
      const dy = end[1] - start[1];
      const length = Math.hypot(dx, dy);

      if (length <= 0.01) {
        continue;
      }

      totalSegmentCount += 1;
      let angle = Math.atan2(dy, dx);

      if (angle < 0) {
        angle += Math.PI;
      }

      const signatureKey = [
        snapValue((start[0] + end[0]) / 2, CORRIDOR_SIGNATURE_PRECISION),
        snapValue((start[1] + end[1]) / 2, CORRIDOR_SIGNATURE_PRECISION),
        Math.round((angle / Math.PI) * CORRIDOR_ANGLE_BUCKETS),
        snapValue(length, CORRIDOR_LENGTH_PRECISION)
      ].join('|');
      const group = corridorGroups.get(signatureKey) ?? {
        count: 0,
        startX: 0,
        startY: 0,
        endX: 0,
        endY: 0
      };

      group.count += 1;
      group.startX += start[0];
      group.startY += start[1];
      group.endX += end[0];
      group.endY += end[1];
      corridorGroups.set(signatureKey, group);
    }
  }

  const collapsedSegmentPaths = [...corridorGroups.values()]
    .map((group) => {
      const start = [group.startX / group.count, group.startY / group.count];
      const end = [group.endX / group.count, group.endY / group.count];
      return [start, end];
    })
    .filter((path) => {
      const [start, end] = path;
      return Math.hypot(end[0] - start[0], end[1] - start[1]) > 0.01;
    });
  const { mergedPaths } = mergeOverlappingPaths(collapsedSegmentPaths, CORRIDOR_ENDPOINT_PRECISION);

  return {
    collapsedPaths: mergedPaths,
    collapseShare: totalSegmentCount > 0 ? 1 - corridorGroups.size / totalSegmentCount : 0
  };
}

function getSnappedPointKey(point, pointByKey, snapPrecision) {
  const snappedX = snapValue(point[0], snapPrecision);
  const snappedY = snapValue(point[1], snapPrecision);
  const pointKey = `${snappedX},${snappedY}`;

  if (!pointByKey.has(pointKey)) {
    pointByKey.set(pointKey, [snappedX, snappedY]);
  }

  return pointKey;
}

function addAdjacency(adjacency, pointKey, segmentKey) {
  const connectedSegmentKeys = adjacency.get(pointKey) ?? new Set();
  connectedSegmentKeys.add(segmentKey);
  adjacency.set(pointKey, connectedSegmentKeys);
}

function walkMergedPath(startPointKey, firstSegmentKey, unusedSegmentKeys, adjacency, segmentByKey, pointByKey) {
  const path = [pointByKey.get(startPointKey)];
  let currentPointKey = startPointKey;
  let currentSegmentKey = firstSegmentKey;

  while (currentSegmentKey) {
    unusedSegmentKeys.delete(currentSegmentKey);
    const segment = segmentByKey.get(currentSegmentKey);
    const nextPointKey = segment.startKey === currentPointKey ? segment.endKey : segment.startKey;

    path.push(pointByKey.get(nextPointKey));
    currentPointKey = nextPointKey;

    const nextSegmentKey = [...(adjacency.get(currentPointKey) ?? [])].find((segmentKey) =>
      unusedSegmentKeys.has(segmentKey)
    );

    if (!nextSegmentKey || (adjacency.get(currentPointKey)?.size ?? 0) !== 2) {
      break;
    }

    currentSegmentKey = nextSegmentKey;
  }

  return path;
}

function snapValue(value, precision) {
  return Math.round(value / precision) * precision;
}

function drawArcLabel(
  ctx,
  {
    text,
    centerX,
    centerY,
    radius,
    startAngle,
    endAngle,
    fillStyle,
    font,
    letterSpacing = 0,
    globalAlpha = 1,
    scale = 1,
    clipOutsideRadius = null
  }
) {
  const glyphs = Array.from(text);

  if (!glyphs.length) {
    return;
  }

  ctx.save();
  ctx.fillStyle = fillStyle;
  ctx.font = font;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.globalAlpha = globalAlpha;

  if (clipOutsideRadius !== null) {
    ctx.beginPath();
    ctx.rect(-10000, -10000, 20000, 20000);
    ctx.arc(centerX, centerY, clipOutsideRadius, 0, Math.PI * 2, true);
    ctx.clip('evenodd');
  }

  const glyphWidths = glyphs.map((glyph) => ctx.measureText(glyph).width);
  const totalWidth = glyphWidths.reduce((sum, width) => sum + width, 0) + letterSpacing * Math.max(0, glyphs.length - 1);
  let currentAngle = (startAngle + endAngle) / 2 - totalWidth / radius / 2;

  glyphs.forEach((glyph, index) => {
    const glyphWidth = glyphWidths[index];
    const halfAngle = glyphWidth / radius / 2;
    const trailingSpacing = index < glyphs.length - 1 ? letterSpacing : 0;

    currentAngle += halfAngle;

    if (glyph.trim()) {
      const x = centerX + Math.cos(currentAngle) * radius;
      const y = centerY + Math.sin(currentAngle) * radius;

      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(currentAngle + Math.PI / 2);
      ctx.scale(scale, scale);
      ctx.fillText(glyph, 0, 0);
      ctx.restore();
    }

    currentAngle += halfAngle + trailingSpacing / radius;
  });

  ctx.restore();
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
