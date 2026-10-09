// FuzeFront Security is the sole authorization decision point for FuzeX.
//
// This module deliberately knows only the stable Security API contract.  It
// does not import a policy SDK or cache decisions: a revoked grant must take
// effect at the next FuzeX request, and the provider behind Security (today
// Permit/OPAL) remains an implementation detail of FuzeFront.

export interface AuthorizationCheck {
  bearerToken: string;
  subject: string;
  tenant: string;
  resource: { type: string; key: string };
  action: string;
}

function securityBaseUrl(): string | null {
  const value = process.env.FUZEFRONT_API_URL?.trim();
  if (!value) return null;
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || url.pathname !== '/') {
      return null;
    }
    return url.origin;
  } catch {
    return null;
  }
}

/**
 * Ask the FuzeFront Security API for one authorization decision.
 *
 * Any ambiguity (missing configuration, timeout, non-200 response, malformed
 * response, or an explicit deny) returns false.  The caller therefore has no
 * failure mode that can accidentally become an allow.
 */
export async function checkFuzeFrontAuthorization(check: AuthorizationCheck): Promise<boolean> {
  const baseUrl = securityBaseUrl();
  if (!baseUrl || !check.bearerToken || !check.subject || !check.tenant || !check.resource.type || !check.resource.key || !check.action) {
    return false;
  }
  try {
    const response = await (globalThis.fetch as typeof fetch)(`${baseUrl}/api/v1/security/authz/check`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${check.bearerToken}`,
        accept: 'application/json',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        subject: check.subject,
        tenant: check.tenant,
        resource: check.resource,
        action: check.action,
      }),
      redirect: 'error',
      signal: AbortSignal.timeout(Number(process.env.FUZEFRONT_AUTHZ_TIMEOUT_MS ?? 3000)),
    });
    if (response.status !== 200) return false;
    const body = await response.json() as unknown;
    return typeof body === 'object' && body !== null && (body as { allow?: unknown }).allow === true;
  } catch {
    return false;
  }
}

export const __testables = { securityBaseUrl };
