import test from 'node:test';
import assert from 'node:assert/strict';
import { parseIssueBody, parseSubmission } from './issue-form.mjs';

const TODAY = '2026-08-22';

const linkBody = `### URL

https://www.example.com/tool/?utm_source=twitter

### Title

My Great Tool

### Category

AI Tools

### Tags

AI, Productivity, ai

### Priority

High

### Description

Does a useful thing.

### Note

_No response_

### Audience

Developers, Job Seekers

### Alternatives

cursor
`;

test('parseIssueBody splits headings into a label map', () => {
  const fields = parseIssueBody(linkBody);
  assert.equal(fields.get('url'), 'https://www.example.com/tool/?utm_source=twitter');
  assert.equal(fields.get('title'), 'My Great Tool');
  assert.equal(fields.get('note'), '', '_No response_ must become empty');
});

test('parseIssueBody handles CRLF, which is what GitHub actually delivers', () => {
  const fields = parseIssueBody('### Title\r\n\r\nWindows Line Endings\r\n');
  assert.equal(fields.get('title'), 'Windows Line Endings');
});

test('parseIssueBody ignores prose that is not a form heading', () => {
  const fields = parseIssueBody('Some preamble\n\n### Title\n\nReal Value\n');
  assert.equal(fields.size, 1);
  assert.equal(fields.get('title'), 'Real Value');
});

test('builds a valid link entry with everything normalized', () => {
  const { kind, entry, group, slug, errors } = parseSubmission('links', linkBody, {
    author: 'octocat',
    today: TODAY,
  });

  assert.deepEqual(errors, []);
  assert.equal(kind, 'links');
  assert.equal(group, 'ai-tools');
  assert.equal(slug, 'my-great-tool');

  assert.equal(entry.url, 'https://example.com/tool', 'tracking params and www stripped');
  assert.equal(entry.category, 'ai-tools');
  assert.deepEqual(entry.tags, ['ai', 'productivity'], 'normalized and de-duplicated');
  assert.equal(entry.priority, 'high', 'dropdown label mapped to the enum value');
  assert.deepEqual(entry.audience, ['developers', 'job-seekers']);
  assert.deepEqual(entry.alternatives, ['cursor']);
  assert.equal(entry.date_added, TODAY);
  assert.equal(entry.source, 'issue-form');
  assert.equal(entry.added_by, 'octocat');
  assert.ok(!('note' in entry), 'blank optional fields are omitted, not written as empty');
});

test('collects every validation problem rather than failing on the first', () => {
  const { errors } = parseSubmission('links', '### URL\n\nnot a url\n\n### Title\n\n\n', {
    today: TODAY,
  });
  assert.ok(errors.length >= 3, `expected url + category + tags errors, got: ${errors}`);
  assert.ok(errors.some((e) => e.includes('not a url')));
});

test('an unknown priority falls back to medium instead of producing invalid data', () => {
  const body = '### URL\n\nhttps://a.com\n\n### Title\n\nA\n\n### Category\n\nx\n\n### Tags\n\nt\n\n### Priority\n\nURGENT!!!\n';
  assert.equal(parseSubmission('links', body, { today: TODAY }).entry.priority, 'medium');
});

test('a malicious title cannot escape the data directory', () => {
  const body =
    '### URL\n\nhttps://evil.example\n\n### Title\n\n../../../../etc/passwd\n\n### Category\n\n../../secrets\n\n### Tags\n\nx\n';
  const { entry, slug, group, errors } = parseSubmission('links', body, { today: TODAY });

  for (const value of [slug, group, entry.category]) {
    assert.doesNotMatch(value, /[./\\]/, `"${value}" must contain no path characters`);
  }
  assert.equal(slug, 'etc-passwd');
  // "../../secrets" has 3 segments once split on "/", each stripped of "." by slugify - the
  // path-segment count no longer matches after normalizing, so slugifyCategoryPath rejects the
  // whole thing outright rather than silently resolving it down to "secrets".
  assert.equal(group, '');
  assert.ok(errors.some((e) => e.includes('Category')));
});

test('a subcategory path is preserved, not flattened into one slug', () => {
  const body =
    '### URL\n\nhttps://a.com\n\n### Title\n\nA\n\n### Category\n\nTechnology / AI Coding Agents\n\n### Tags\n\nt\n';
  const { entry, group, errors } = parseSubmission('links', body, { today: TODAY });
  assert.deepEqual(errors, []);
  assert.equal(entry.category, 'technology/ai-coding-agents');
  assert.equal(group, 'technology/ai-coding-agents');
});

test('a shadow-library-style category automatically sets legal_risk', () => {
  const body =
    '### URL\n\nhttps://a.com\n\n### Title\n\nA\n\n### Category\n\nLearning / Books Academic Papers\n\n### Tags\n\nt\n';
  const { entry, errors } = parseSubmission('links', body, { today: TODAY });
  assert.deepEqual(errors, []);
  assert.equal(entry.legal_risk, true);
});

test('legal_risk is omitted entirely outside the categories that require it', () => {
  const { entry } = parseSubmission('links', linkBody, { today: TODAY });
  assert.ok(!('legal_risk' in entry));
});

test('a three-segment category is accepted, not truncated - depth is unbounded', () => {
  const body =
    '### URL\n\nhttps://a.com\n\n### Title\n\nA\n\n### Category\n\na/b/c\n\n### Tags\n\nt\n';
  const { entry, errors } = parseSubmission('links', body, { today: TODAY });
  assert.deepEqual(errors, []);
  assert.equal(entry.category, 'a/b/c');
});

const companyBody = `### Company name

Acme Corp

### Website

https://acme.example

### Country

United States

### Industry

Fintech

### Careers URL

https://acme.example/jobs

### Hiring status

Actively hiring

### Size

Mid-size

### Remote policy

Hybrid

### Why is it notable?

They pay well.

### Tags

fintech, remote
`;

test('builds a valid company entry', () => {
  const { kind, entry, group, slug, errors } = parseSubmission('companies', companyBody, {
    today: TODAY,
  });

  assert.deepEqual(errors, []);
  assert.equal(kind, 'companies');
  assert.equal(group, 'united-states');
  assert.equal(slug, 'acme-corp');

  assert.equal(entry.name, 'Acme Corp');
  assert.equal(entry.country, 'united-states');
  assert.equal(entry.industry, 'fintech');
  assert.equal(entry.hiring_status, 'actively-hiring');
  assert.equal(entry.remote_policy, 'hybrid');
  assert.equal(entry.careers_url, 'https://acme.example/jobs');
  assert.equal(entry.rating, 'They pay well.');
  assert.equal(entry.source, 'issue-form');
  // "Mid-size" slugifies to "mid-size", which is not a valid enum value, so it is dropped
  // rather than written as invalid data.
  assert.ok(!('size' in entry));
});

test('company defaults are the unknown values, not missing fields', () => {
  const body = '### Company name\n\nX\n\n### Website\n\nhttps://x.example\n\n### Country\n\nPakistan\n\n### Industry\n\nSaaS\n';
  const { entry, errors } = parseSubmission('companies', body, { today: TODAY });
  assert.deepEqual(errors, []);
  assert.equal(entry.hiring_status, 'unknown');
  assert.equal(entry.remote_policy, 'unknown');
});

test('rejects an unknown submission kind', () => {
  assert.throws(() => parseSubmission('widgets', '', { today: TODAY }), /Unknown submission kind/);
});
