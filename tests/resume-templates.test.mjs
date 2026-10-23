import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { templates, normalizeDesign, sampleResume, blankResume } from '../shared/templates.mjs';

const additions = ['billryan', 'stackoverflow', 'kendall', 'macchiato'];

test('four new templates are selectable and retain traceable MIT source snapshots', async () => {
  assert.equal(templates.length, 15);
  assert.equal(new Set(templates.map(item => item.id)).size, 15);
  const manifest = JSON.parse(await readFile(new URL('../assets/resume-templates/sources.json', import.meta.url), 'utf8'));
  for (const id of additions) {
    const item = templates.find(item => item.id === id);
    assert.ok(item, id);
    assert.equal(item.license, 'MIT');
    assert.match(item.source, /^https:\/\/github\.com\//);
    const source = manifest.templates.find(item => item.id === id);
    assert.match(source.source_tree_sha, /^[0-9a-f]{40}$/);
    assert.ok(source.files.some(item => item.file === 'LICENSE'));
    for (const file of source.files) {
      const bytes = await readFile(new URL(`../assets/resume-templates/${id}/${file.file}`, import.meta.url));
      assert.equal(createHash('sha256').update(bytes).digest('hex'), file.sha256, id + '/' + file.file);
    }
  }
});

test('academic and technical defaults differ, while an explicit user order is preserved', () => {
  assert.equal(normalizeDesign({}, 'billryan').order[0], 'education');
  const technical = normalizeDesign({}, 'stackoverflow').order;
  assert.ok(technical.indexOf('projects') < technical.indexOf('experience'));
  assert.equal(normalizeDesign({ order: ['awards', 'skills'] }, 'billryan').order[0], 'awards');
  assert.equal(normalizeDesign({}, 'classic').order[0], 'summary');
  assert.deepEqual(blankResume().basics, { name: '', headline: '', email: '', phone: '', city: '', website: '', summary: '' });
});

test('new layouts retain each editable field once and safely hide selected sections in exports', async () => {
  assert.ok(templates.some(item => item.id === 'kendall'));
  const { resumeMarkup } = await import('../workspace/resume-renderer.js');
  const data = sampleResume();
  data.basics.name = '<script>alert(1)</script>';
  for (const id of additions) {
    const markup = resumeMarkup(data, id, true);
    for (const path of ['basics.name', 'basics.email', 'education.0.school', 'experience.0.details', 'projects.0.name', 'skills', 'awards']) {
      assert.equal(markup.split(`data-resume-field="${path}"`).length - 1, 1, id + ': ' + path);
    }
    assert.ok(markup.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
    assert.ok(!markup.includes('<script>'));
    const exported = resumeMarkup({ ...data, design: { hidden: ['skills', 'awards'] } }, id, false);
    assert.ok(!exported.includes('data-resume-section="skills"'));
    assert.ok(!exported.includes('data-resume-section="awards"'));
    assert.ok(exported.includes('data-resume-section="projects"'));
    assert.ok(!exported.includes('contenteditable'));
  }
});

test('Macchiato reading order follows the visible left contact column', async () => {
  const { resumeMarkup } = await import('../workspace/resume-renderer.js');
  const html = resumeMarkup(sampleResume(), 'macchiato', false);
  assert.ok(html.indexOf('data-resume-section="contact"') < html.indexOf('data-resume-section="education"'));
});
