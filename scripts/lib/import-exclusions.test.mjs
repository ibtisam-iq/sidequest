import test from 'node:test';
import assert from 'node:assert/strict';
import { isExcluded } from './import-exclusions.mjs';

test('excludes the site owner\'s own personal profile and contact links', () => {
  assert.ok(isExcluded('https://x.com/ibtisam_iq'));
  assert.ok(isExcluded('https://wa.me/923046210233'));
  assert.ok(isExcluded('https://www.facebook.com/ibtisam.iqx'));
  assert.ok(isExcluded('https://github.com/ibtisam-iq'));
  assert.ok(isExcluded('https://www.linkedin.com/in/ibtisam-iq/'));
  assert.ok(isExcluded('https://buymeacoffee.com/ibtisam.iq'));
});

test('excludes personal ephemera: a specific reel, short, or one-off purchase', () => {
  assert.ok(isExcluded('https://www.facebook.com/reel/24095672226773662'));
  assert.ok(isExcluded('https://www.youtube.com/shorts/VZ5wuw1YZ8o'));
  assert.ok(isExcluded('https://www.amazon.com/Casio-F91W-1-Classic-Resin-Digital/dp/B000GAWSDG/?th=1'));
  assert.ok(isExcluded('https://www.daraz.pk/products/e-tachi-ipro-4g-name-i491545020.html'));
  assert.ok(isExcluded('https://en-pk.svestonwatches.com/collections/mens-wrist-watches/products/x'));
});

test('does not exclude a genuine resource just because it shares a domain', () => {
  // A repo under a different GitHub user must not be caught by the owner's own profile rule.
  assert.equal(isExcluded('https://github.com/awesome-selfhosted/awesome-selfhosted'), false);
  // A regular YouTube video (not a /shorts/ URL) is a real lecture, not ephemera.
  assert.equal(isExcluded('https://www.youtube.com/watch?v=9nz37xLhKM4'), false);
  assert.equal(isExcluded('https://ghostty.org'), false);
});
