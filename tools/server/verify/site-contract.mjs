// Pure host-contract checks shared by verify-site.mjs (phase 5, task 5.5).
//
// Returns a finding string when the header or redirect does not match the
// T5.1 / T5.5 contract; otherwise undefined.

const approvedHstsMaxAge = /(?:^|;)\s*max-age=31536000(?:;|$)/u;
const includeSubDomains = /\bincludeSubDomains\b/iu;
const noIndexToken = /\bnoindex\b/iu;

export function indexableFinding(label, headers) {
  const robotsTag = headers.get("x-robots-tag") ?? "";
  if (noIndexToken.test(robotsTag)) {
    return `${label} must not send X-Robots-Tag noindex: ${robotsTag}.`;
  }
  return undefined;
}

export function hstsPresentFinding(label, headers) {
  const hsts = headers.get("strict-transport-security") ?? "";
  if (!approvedHstsMaxAge.test(hsts) || includeSubDomains.test(hsts)) {
    return `${label} Strict-Transport-Security must be max-age=31536000 without includeSubDomains: ${hsts || "absent"}.`;
  }
  return undefined;
}

export function wwwRedirectFinding({ status, location, apexOrigin, wwwUrl }) {
  const expected = new URL("/ca/", apexOrigin);
  let redirectsToApex = false;
  if ((status === 301 || status === 308) && location !== "") {
    try {
      const resolved = new URL(location, wwwUrl);
      redirectsToApex =
        resolved.origin === expected.origin &&
        resolved.pathname === expected.pathname;
    } catch {
      redirectsToApex = false;
    }
  }
  if (!redirectsToApex) {
    return `www ${wwwUrl} returned ${status} Location ${location || "absent"}, expected a redirect to ${expected.origin}${expected.pathname}.`;
  }
  return undefined;
}
