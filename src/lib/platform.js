export function supportsInteractiveDepthEffects() {
  return window.matchMedia('(hover: hover) and (pointer: fine)').matches;
}

export function shouldUseSoftHoverEffects() {
  if (!supportsInteractiveDepthEffects()) {
    return false;
  }

  const userAgent = navigator.userAgent ?? '';
  const platform = navigator.userAgentData?.platform ?? navigator.platform ?? '';
  const isWindows = /Windows/i.test(`${platform} ${userAgent}`);
  const isChromium = /\b(?:Chrome|CriOS|Edg|EdgA)\//.test(userAgent) && !/\bFirefox\//.test(userAgent);

  return isWindows && isChromium;
}
