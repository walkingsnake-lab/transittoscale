export const DISPLAY_PROFILES = Object.freeze({
  standard: Object.freeze({
    simplifyTolerance: 0.5,
    lineWidth: 1.65,
    lineAlpha: 0.94
  }),
  dense: Object.freeze({
    simplifyTolerance: 0.9,
    lineWidth: 1.45,
    lineAlpha: 0.88
  }),
  mega: Object.freeze({
    simplifyTolerance: 1.4,
    lineWidth: 1.2,
    lineAlpha: 0.8
  })
});

export function getDisplayProfileFromLineCount(lineCount) {
  if (lineCount <= 5) {
    return 'standard';
  }

  if (lineCount <= 14) {
    return 'dense';
  }

  return 'mega';
}

export function resolveDisplayProfile(requestedProfile, lineCount) {
  if (requestedProfile && DISPLAY_PROFILES[requestedProfile]) {
    return requestedProfile;
  }

  return getDisplayProfileFromLineCount(lineCount);
}

export function createCityDisplay(requestedProfile, lineCount) {
  const profile = resolveDisplayProfile(requestedProfile, lineCount);

  return {
    profile,
    ...DISPLAY_PROFILES[profile]
  };
}
