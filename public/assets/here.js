/**
 * "Use my location": the phone's position → the nearest UK postcode.
 * The browser asks the customer first. The position is used once for this lookup and never stored.
 * Plain fetch, so any page can use it.
 */
export async function postcodeHere() {
  if (!navigator.geolocation) throw new Error('This browser cannot share your location. Type the postcode instead.');
  const pos = await new Promise((ok, bad) => navigator.geolocation.getCurrentPosition(ok, bad, { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 }))
    .catch((e) => {
      throw new Error(e && e.code === 1
        ? 'Location is turned off for this site. Allow location in your browser settings, or type the postcode.'
        : 'We could not get your location. Try again, or type the postcode.');
    });
  const { latitude: lat, longitude: lng } = pos.coords;
  const r = await fetch(`/api/address/near?lat=${lat.toFixed(6)}&lng=${lng.toFixed(6)}`, { headers: { Accept: 'application/json' } });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j?.error?.message || j?.message || 'We could not find a postcode near you. Type it instead.');
  return j;
}

export const PIN_SVG = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 22s7-6.2 7-12a7 7 0 0 0-14 0c0 5.8 7 12 7 12z"></path><circle cx="12" cy="10" r="2.5"></circle></svg>';
