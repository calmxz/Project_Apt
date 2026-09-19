// Shared credential validation for the auth covers. One regex and one
// minimum length, so sign-in, register and reset cannot drift apart.

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/

export const MIN_PASSWORD_LEN = 8

export function isValidEmail(s) {
  return EMAIL_RE.test(s)
}

export function isValidPassword(s) {
  return s.length >= MIN_PASSWORD_LEN
}

// True only once the learner has typed something into confirm: an empty
// confirm field is "not filled in yet", not "wrong".
export function passwordsMismatch(pw, confirm) {
  return confirm.length > 0 && confirm !== pw
}
