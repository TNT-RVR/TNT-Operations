/**
 * A "take me there" link for a coordinate.
 *
 * Deliberately not one URL for everyone. On an iPhone the Google URL opens a
 * web page unless the Google Maps app happens to be installed, which is a poor
 * result for a crew in a truck; Apple's own scheme hands straight to Maps.
 * Everywhere else, Google's `dir` URL is the one that opens the installed app
 * on Android and a usable page on a desktop.
 */
export function navigationUrl(
  lat: number,
  lng: number,
  userAgent: string = typeof navigator === 'undefined' ? '' : navigator.userAgent,
): string {
  const coords = `${lat.toFixed(6)},${lng.toFixed(6)}`
  // iPadOS 13+ reports itself as a Mac, so 'Macintosh' with touch counts too;
  // matching either is enough for the crews' devices.
  const apple = /iPhone|iPad|iPod|Macintosh/i.test(userAgent)
  return apple
    ? `https://maps.apple.com/?daddr=${coords}&dirflg=d`
    : `https://www.google.com/maps/dir/?api=1&destination=${coords}&travelmode=driving`
}
