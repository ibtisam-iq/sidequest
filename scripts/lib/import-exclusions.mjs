/**
 * Rows that must never reach the review file, let alone the dataset: the site owner's own
 * personal profile/contact links, and one-off personal ephemera that isn't a reusable resource
 * (a single social media post, a specific song, a one-off purchase listing).
 *
 * Matched as substrings of the raw URL - deliberately not normalized-URL equality, since these
 * are meant to be an obvious, auditable blocklist a human can read directly, not a computed set.
 */
export const EXCLUDED_URL_SUBSTRINGS = [
  // The site owner's own personal profile / contact info.
  'x.com/ibtisam_iq',
  'wa.me/923046210233',
  'facebook.com/ibtisam.iqx',
  'github.com/ibtisam-iq',
  'linkedin.com/in/ibtisam-iq',
  'buymeacoffee.com/ibtisam.iq',

  // Personal ephemera: not a reusable resource.
  'facebook.com/reel/', // a specific Facebook reel, not a resource
  'youtube.com/watch?v=iaHaY2ZJEbY', // a specific lofi song
  'youtube.com/shorts/', // a specific short clip, not a lecture/resource
  '/dp/B000GAWSDG', // Casio watch - a one-off personal purchase
  'daraz.pk/products/e-tachi-ipro', // Daraz phone listing - a one-off personal purchase
  'svestonwatches.com', // smartwatch product page - a one-off personal purchase
];

export function isExcluded(url) {
  return EXCLUDED_URL_SUBSTRINGS.some((s) => url.includes(s));
}
