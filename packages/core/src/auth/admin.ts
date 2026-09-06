/**
 * Owner allowlist for the reconciliation view.
 *
 * There is no admin ROLE in the tier model — admin is not something a payment
 * can buy — so it is an env allowlist, matched against the signed session email.
 * Unset means nobody is an admin, and the page 404s for everyone: an internal
 * surface must never announce itself to a reader who is not on the list.
 */
export function adminEmails(): string[] {
  return (process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

export function isAdmin(email: string | null | undefined): boolean {
  if (!email) return false;
  return adminEmails().includes(email.toLowerCase());
}
