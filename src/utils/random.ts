/**
 * Gets a simple random string to use as a simple hash.
 * Examples:  kk8kpv7egv, j0mqyf2gx8a, 9idddjb2pf
 */
export function getRandomString() {
  return Math.random().toString(36).substring(2);
}

if (import.meta.main) {
  console.log(getRandomString());
}
