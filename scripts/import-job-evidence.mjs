import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { mergeEvidenceDocument } from '../server/catalog-reviews.mjs';

export function importEvidenceFile({ catalog, evidence, reviews, reviewedAt = new Date().toISOString() }) {
  const jobs = catalog.jobs || [];
  const merged = mergeEvidenceDocument(jobs, reviews, evidence.results || [], reviewedAt);
  return merged;
}

async function main() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const args = process.argv.slice(2);
  const option = (name, fallback) => { const index = args.indexOf(name); return index >= 0 ? args[index + 1] : fallback; };
  const catalogPath = path.resolve(option('--catalog', path.join(root, 'data', 'jobs-2027.json')));
  const evidencePath = path.resolve(option('--evidence', ''));
  const reviewsPath = path.resolve(option('--reviews', path.join(root, 'data', 'job-workflow-reviews.json')));
  if (!evidencePath) throw new Error('请用 --evidence 指定本次核验结果 JSON。');
  const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
  const evidence = JSON.parse(fs.readFileSync(evidencePath, 'utf8'));
  const reviews = fs.existsSync(reviewsPath) ? JSON.parse(fs.readFileSync(reviewsPath, 'utf8')) : { schema_version: 1, reviews: [] };
  const merged = importEvidenceFile({ catalog, evidence, reviews, reviewedAt: evidence.checked_at || new Date().toISOString() });
  if (!args.includes('--write')) {
    console.log(JSON.stringify({ dryRun: true, ...merged.report, reviewed_at: merged.document.reviewed_at }));
    return;
  }
  const backup = reviewsPath + '.bak';
  if (fs.existsSync(reviewsPath) && !fs.existsSync(backup)) fs.copyFileSync(reviewsPath, backup);
  fs.writeFileSync(reviewsPath, JSON.stringify(merged.document, null, 2) + '\n');
  console.log(JSON.stringify({ wrote: reviewsPath, backup: fs.existsSync(backup) ? backup : null, ...merged.report }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) await main();
