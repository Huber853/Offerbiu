"""One-time data repair: keep relative source labels, normalize only explicit dates.
Does not modify users, applications, resumes, sessions or source evidence.
"""
import datetime as dt
import json
import sqlite3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
seed = ROOT / 'data' / 'jobs-2027.json'

def normalize(job):
    changed = False
    for field in ('published_at', 'updated_at', 'deadline'):
        value = job.get(field)
        if value is None or value == '':
            continue
        try:
            normalized = dt.date.fromisoformat(str(value).strip()).isoformat()
        except ValueError:
            normalized = None
        if value != normalized:
            job[field + '_raw'] = value
            job[field] = normalized
            changed = True
    return changed

bundle = json.loads(seed.read_text(encoding='utf-8'))
seed_changes = 0
for job in bundle['jobs']:
    seed_changes += int(normalize(job))
if seed_changes:
    bundle['jobs'].sort(key=lambda j: (j.get('updated_at') or j.get('published_at') or '', j['id']), reverse=True)
    pending = seed.with_suffix('.pending.json')
    pending.write_text(json.dumps(bundle, ensure_ascii=False, indent=2), encoding='utf-8')
    pending.replace(seed)

database = ROOT / 'storage' / 'offerbiu.sqlite'
db_changes = 0
if database.exists():
    with sqlite3.connect(database, timeout=15) as connection:
        for job_id, payload in connection.execute('SELECT id,payload FROM jobs').fetchall():
            job = json.loads(payload)
            if normalize(job):
                connection.execute('UPDATE jobs SET payload=? WHERE id=?', (json.dumps(job, ensure_ascii=False), job_id))
                db_changes += 1
print(json.dumps({'seed_records_updated': seed_changes, 'database_records_updated': db_changes, 'source_labels_preserved': True}, ensure_ascii=False))
