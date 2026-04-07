export const DISPLAY_PROFILES = Object.freeze({
  standard: Object.freeze({
    lineWidth: 1.65,
    simplifyTolerance: 1,
    lineAlpha: 0.94
  }),
  dense: Object.freeze({
    lineWidth: 1.55,
    simplifyTolerance: 1.6,
    lineAlpha: 0.8
  }),
  mega: Object.freeze({
    lineWidth: 1.45,
    simplifyTolerance: 2.4,
    lineAlpha: 0.7
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
