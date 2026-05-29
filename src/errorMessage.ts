// Translate Firestore / Web Crypto / network errors into plain-language
// strings suitable for the chat error banner. Caller decides where it
// lands (banner, inline, toast); this helper just owns the copy.
//
// Why centralized: the chat view assigns error.value from 6+ catch blocks,
// each previously dumping `err.message` or `String(err)` (Firebase strings
// like "FirebaseError: Missing or insufficient permissions" are alien to
// non-developers). One translate point keeps voice consistent and lets us
// retune copy without hunting through views.
//
// Coverage philosophy: hand-translate the handful of error shapes we
// actually produce on the wire (permission, network, decrypt, decoded
// Firebase code paths). Everything else falls through to a friendly
// generic with "tap to retry" semantics that the caller can act on.

export interface FriendlyError {
  /** Plain-language one-liner for the user. */
  message: string
  /** Whether retrying the original action is likely to help. */
  retryable: boolean
}

/**
 * Pattern-match an unknown error against the shapes we expect from
 * Firestore SDK, Web Crypto, and the browser network stack. Always
 * returns a `FriendlyError` — never throws, never returns null —
 * so callers can use it as a single assignment without try/catch.
 */
export function friendlyError(err: unknown): FriendlyError {
  // Firebase errors carry a `code` like "permission-denied" / "unavailable"
  // — far more reliable than substring-matching the human message, which
  // changes between SDK versions and locales.
  const fbCode = firebaseCode(err)
  if (fbCode) {
    switch (fbCode) {
      case 'permission-denied':
        return {
          message:
            "Can't do that here. The session may have been deleted from the other side, or its rules changed.",
          retryable: false,
        }
      case 'unavailable':
      case 'deadline-exceeded':
      case 'cancelled':
        return { message: 'Connection trouble. Tap to retry.', retryable: true }
      case 'unauthenticated':
        return {
          message: 'Lost your sign-in. Reload the page to recover.',
          retryable: false,
        }
      case 'not-found':
        return {
          message: 'That message or session is gone. It may have vanished or been deleted.',
          retryable: false,
        }
      case 'resource-exhausted':
        return {
          message: 'Too many requests. Wait a moment and try again.',
          retryable: true,
        }
      case 'failed-precondition':
      case 'aborted':
        return {
          message: 'Something changed while we were saving. Tap to retry.',
          retryable: true,
        }
    }
  }

  // Network-layer failures: the fetch / WebChannel rejection surfaces
  // either as a `TypeError: Failed to fetch` (Chrome) or `NetworkError`
  // (Firefox) before Firebase wraps it. Catch by name so we don't have to
  // chase platform-specific message text.
  if (err instanceof TypeError && /failed to fetch|networkerror/i.test(err.message)) {
    return { message: 'No connection. Tap to retry.', retryable: true }
  }

  // Web Crypto decrypt failure — surfaces from messages.ts when the
  // recipient can't decode a payload (wrong key, corrupted IV, bytes
  // tampered). Caller usually renders this inline as a `[unable to
  // decrypt]` placeholder rather than in the banner, but if it reaches
  // here we translate.
  if (err instanceof DOMException && err.name === 'OperationError') {
    return {
      message: "Couldn't read that message. The encryption may not match.",
      retryable: false,
    }
  }

  // Last resort: known-shaped Error with a message → keep it concise.
  // Otherwise stringify. Always retryable=true: when we don't know what
  // happened, letting the user retry is the safer default than telling
  // them they're stuck.
  if (err instanceof Error && err.message) {
    return { message: 'Something went wrong. Tap to retry.', retryable: true }
  }
  return { message: 'Something went wrong. Tap to retry.', retryable: true }
}

function firebaseCode(err: unknown): string | null {
  if (typeof err !== 'object' || err === null) return null
  const code = (err as { code?: unknown }).code
  return typeof code === 'string' ? code : null
}
