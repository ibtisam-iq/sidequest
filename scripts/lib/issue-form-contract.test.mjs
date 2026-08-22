/**
 * Guards the contract between the GitHub Issue Forms and the parser.
 *
 * The parser keys off the human-readable field *labels*, because that is all GitHub puts in the
 * rendered issue body. So renaming a label in the form silently drops that field — no error,
 * just missing data in every future submission. These tests fail loudly instead, by simulating
 * the body GitHub would produce from each form and asserting the round-trip.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { load } from 'js-yaml';
import { REPO_ROOT } from './yaml-io.mjs';
import { parseSubmission } from './issue-form.mjs';

const TODAY = '2026-08-22';

const formPath = (name) => path.join(REPO_ROOT, '.github', 'ISSUE_TEMPLATE', name);

async function loadForm(name) {
  return load(await readFile(formPath(name), 'utf8'));
}

/** Reproduces how GitHub renders a submitted issue form into the issue body. */
function renderIssueBody(form, answers) {
  return form.body
    .filter((field) => field.type !== 'markdown')
    .map((field) => {
      const value = answers[field.attributes.label] ?? '_No response_';
      return `### ${field.attributes.label}\n\n${value}\n`;
    })
    .join('\n');
}

test('every add-link form field is understood by the parser', async () => {
  const form = await loadForm('add-link.yml');

  const answers = {
    URL: 'https://example.com/thing',
    Title: 'Contract Test Tool',
    Category: 'Dev Tools',
    Tags: 'alpha, beta',
    Priority: 'Low',
    Description: 'A description.',
    Note: 'A note.',
    Audience: 'Developers',
    Alternatives: 'warp',
  };

  // Every non-markdown field must be covered by the fixture, or this test proves nothing.
  const labels = form.body.filter((f) => f.type !== 'markdown').map((f) => f.attributes.label);
  assert.deepEqual(
    labels.filter((l) => !(l in answers)),
    [],
    'a form field is missing from this test fixture',
  );

  const { entry, errors } = parseSubmission('links', renderIssueBody(form, answers), {
    author: 'octocat',
    today: TODAY,
  });

  assert.deepEqual(errors, []);
  assert.equal(entry.title, 'Contract Test Tool');
  assert.equal(entry.category, 'dev-tools');
  assert.deepEqual(entry.tags, ['alpha', 'beta']);
  assert.equal(entry.priority, 'low');
  assert.equal(entry.description, 'A description.');
  assert.equal(entry.note, 'A note.');
  assert.deepEqual(entry.audience, ['developers']);
  assert.deepEqual(entry.alternatives, ['warp']);
});

test('every add-company form field is understood by the parser', async () => {
  const form = await loadForm('add-company.yml');

  const answers = {
    'Company name': 'Contract Test Co',
    Website: 'https://contract.example',
    Country: 'Pakistan',
    Industry: 'SaaS',
    'Careers URL': 'https://contract.example/jobs',
    'Hiring status': 'Actively hiring',
    Size: 'Mid',
    'Remote policy': 'Hybrid',
    'Why is it notable?': 'Because it is a test.',
    Tags: 'testing',
  };

  const labels = form.body.filter((f) => f.type !== 'markdown').map((f) => f.attributes.label);
  assert.deepEqual(
    labels.filter((l) => !(l in answers)),
    [],
    'a form field is missing from this test fixture',
  );

  const { entry, errors } = parseSubmission('companies', renderIssueBody(form, answers), {
    today: TODAY,
  });

  assert.deepEqual(errors, []);
  assert.equal(entry.name, 'Contract Test Co');
  assert.equal(entry.country, 'pakistan');
  assert.equal(entry.industry, 'saas');
  assert.equal(entry.careers_url, 'https://contract.example/jobs');
  assert.equal(entry.hiring_status, 'actively-hiring');
  assert.equal(entry.size, 'mid');
  assert.equal(entry.remote_policy, 'hybrid');
  assert.equal(entry.rating, 'Because it is a test.');
  assert.deepEqual(entry.tags, ['testing']);
});

test('every dropdown option maps to a real schema enum value', async () => {
  // A dropdown option that does not slugify onto an allowed value gets silently discarded
  // (or defaulted), which is exactly the kind of thing nobody notices until the data is wrong.
  const cases = [
    ['add-link.yml', 'links', { Priority: ['high', 'medium', 'low'] }],
    [
      'add-company.yml',
      'companies',
      {
        'Hiring status': ['actively-hiring', 'unknown', 'not-hiring'],
        Size: ['startup', 'mid', 'enterprise'],
        'Remote policy': ['remote', 'hybrid', 'onsite', 'unknown'],
      },
    ],
  ];

  for (const [file, , expected] of cases) {
    const form = await loadForm(file);
    for (const field of form.body) {
      if (field.type !== 'dropdown') continue;
      const label = field.attributes.label;
      const allowed = expected[label];
      assert.ok(allowed, `unexpected dropdown "${label}" in ${file}`);

      for (const option of field.attributes.options) {
        const slug = option.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
        assert.ok(
          allowed.includes(slug),
          `${file}: dropdown option "${option}" slugifies to "${slug}", which is not a valid value (${allowed.join(', ')})`,
        );
      }
    }
  }
});

test('the forms apply the labels the workflow routes on', async () => {
  assert.deepEqual((await loadForm('add-link.yml')).labels, ['new-link']);
  assert.deepEqual((await loadForm('add-company.yml')).labels, ['new-company']);
});
