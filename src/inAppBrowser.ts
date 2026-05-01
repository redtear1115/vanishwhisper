// Detects whether the page is loaded inside a known in-app browser (Threads,
// Instagram, Facebook, LINE, WeChat, TikTok, X). The threat for
// VanishWhisper is concrete: identity (RSA keypair) lives in IndexedDB,
// which on iOS is sandboxed per-app — a keypair created in Threads' webview
// cannot be reached from Safari later, so the user effectively loses every
// session they accept here. Same hazard on Android, just less strict
// isolation. The banner this powers steers users into their real browser
// before any identity-binding step happens.
//
// Detection is intentionally allow-list by UA token. We do NOT fall back to
// "no Safari in UA → in-app webview" because the same shape applies to
// installed PWAs (navigator.standalone / display-mode: standalone) and we
// must not warn those users — their identity is stored in the PWA's own
// origin and is fine.

// UA tokens for the in-app webviews we want to flag. Names are inline for
// grep / future-maintenance only — we don't surface them in the UI (the
// banner shows a generic "in-app browser" message regardless of which app).
const PATTERNS: RegExp[] = [
  /\bThreads\b|Barcelona/, // Threads (Barcelona was its codename on Android)
  /\bInstagram\b/,
  /FBAN|FBAV|FB_IAB|FBIOS/, // Facebook
  /\bLine\//,
  /MicroMessenger/, // WeChat
  /BytedanceWebview|musical_ly/, // TikTok
  /TwitterAndroid/, // X
]

export function detectInAppBrowser(ua: string = navigator.userAgent): boolean {
  if (typeof window !== 'undefined') {
    const standalone =
      (navigator as Navigator & { standalone?: boolean }).standalone === true ||
      window.matchMedia?.('(display-mode: standalone)').matches === true
    if (standalone) return false
  }
  return PATTERNS.some((re) => re.test(ua))
}
