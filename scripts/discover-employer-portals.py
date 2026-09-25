"""Harvest employer-hosted graduate portals referenced by archived NWU postings.

Discovery stage only: it publishes nothing and admits no rows. The output is a
candidate table (company -> portal host -> platform) that is reviewed, then
promoted into the collector configuration lists and data/job-source-policy.json.
Third-party job boards are bucketed separately because the catalog only accepts
employer-owned and NWU sources.
"""
import argparse
import json
import re
import urllib.parse
from collections import Counter, defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SOURCES = ROOT / 'data/sources'
OUT = ROOT / 'data/portal-candidates.json'

# Hosts that are platform plumbing, media or unrelated; never employer portals.
NOISE = ('jczx.nwu.edu.cn', 'jiuyeb.cn', 'weixin.qq.com', 'qpic.cn', 'wps.cn', 'bsurl.cn',
         'xinhuaxmt.com', 'thepaper.cn', 'cyol.com', 'un.org', 'mdpi.cn', 'bilibili.com',
         'jinshuju.com', 'gov.cn')

THIRD_PARTY = ('zhaopin.com', '51job.com', 'chinahr.com', 'nowcoder.com', 'shixiseng.com',
               'yingjiesheng.com', 'liepin.com', 'lagou.com', 'bosszhipin.com', 'dajie.com')


def classify(host):
    """Map a referenced host to the platform that owns the portal."""
    host = host.lower()
    if host.endswith('.zhiye.com'):
        return 'beisen'
    if host.endswith('.mokahr.com'):
        return 'moka'
    if host.endswith('.jobs.feishu.cn') or host.endswith('.jobs.f.mioffice.cn'):
        return 'feishu'
    if host.endswith('.mioffice.cn'):
        return 'feishu'
    if host == 'applyjob.chinahr.com' or any(host.endswith(x) for x in THIRD_PARTY):
        return 'third_party'
    return 'employer_site'


def urls_in(text):
    text = text.replace('\\/', '/')
    found = re.findall(r'https?://[^\s"\'<>)\\]{4,120}', text)
    result = []
    for url in found:
        try:
            host = urllib.parse.urlparse(url).hostname or ''
        except ValueError:
            continue
        if not host or any(host.endswith(x) for x in NOISE):
            continue
        result.append((host.lower(), url.split('）')[0].split('。')[0].rstrip('，,、;；')))
    return result


def scan(patterns):
    portals = defaultdict(lambda: {'postings': 0, 'companies': Counter(), 'samples': []})
    files = 0
    failures = 0
    for pattern in patterns:
        for path in sorted(SOURCES.glob(pattern)):
            files += 1
            try:
                if path.stat().st_size > 4_000_000:
                    continue
                text = path.read_text(encoding='utf-8', errors='replace')
            except OSError:
                failures += 1
                continue
            company = None
            match = re.search(r'"com_id_name"\s*:\s*"([^"]{2,60})"', text)
            if match:
                company = match.group(1)
            for host, url in urls_in(text):
                bucket = portals[host]
                bucket['postings'] += 1
                if company:
                    bucket['companies'][company] += 1
                if len(bucket['samples']) < 3 and url not in [s[1] for s in bucket['samples']]:
                    bucket['samples'].append((company or '', url))
    return files, portals, failures


def probe(slugs):
    """Verify candidate tenant slugs against the platforms the collectors already support.

    A tenant is usable when its public campus page carries the platform config the
    collector reads, so this reports the confirmed slug, platform and campaign id
    instead of guessing URLs into the policy file.
    """
    import urllib.request
    results = []
    for slug in slugs:
        slug = slug.strip().lower()
        if not slug:
            continue
        checks = [
            ('beisen', f'https://{slug}.zhiye.com/campus/jobs', r'var BSGlobal = (\{.*?\});'),
            ('moka', f'https://app.mokahr.com/campus-recruitment/{slug}', r'"siteId"\s*:\s*"?(\d+)"?'),
        ]
        for platform, url, pattern in checks:
            try:
                request = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
                with urllib.request.urlopen(request, timeout=20) as response:
                    text = response.read().decode('utf-8', 'replace')
                if len(text) < 200:
                    continue
                found = re.search(pattern, text)
                if platform == 'beisen' and not found:
                    continue
                # Confirm whose portal this is before the slug is promoted into the
                # policy file, otherwise a slug can silently point at another employer.
                title = re.search(r'<title>(.*?)</title>', text, re.S)
                company = re.search(r'companyName["\']?\s*[:=]\s*["\']([^"\']{2,40})["\']', text)
                results.append({'slug': slug, 'platform': platform, 'url': url, 'matched': bool(found),
                                'title': (title.group(1).strip()[:70] if title else None),
                                'company': (company.group(1).strip()[:40] if company else None)})
                break
            except Exception as error:
                results.append({'slug': slug, 'platform': platform, 'url': url, 'error': str(error)[:80]})
                break
    return results


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--include', default='*/nwu-detail-*.json',
                        help='Comma separated glob patterns under data/sources')
    parser.add_argument('--probe', default=None,
                        help='Comma separated candidate tenant slugs to verify against Beisen/Moka')
    args = parser.parse_args()
    if args.probe:
        rows = probe(args.probe.split(','))
        OUT.write_text(json.dumps({'probed': rows}, ensure_ascii=False, indent=2), encoding='utf-8')
        print(json.dumps({'probed': len(rows)}, ensure_ascii=False))
        for row in rows:
            print(json.dumps(row, ensure_ascii=False))
        return
    patterns = [p.strip() for p in args.include.split(',') if p.strip()]
    files, portals, failures = scan(patterns)

    rows = []
    for host, bucket in portals.items():
        rows.append({'host': host, 'platform': classify(host), 'postings': bucket['postings'],
                     'companies': [c for c, _ in bucket['companies'].most_common(6)],
                     'samples': [u for _, u in bucket['samples']]})
    rows.sort(key=lambda r: (-r['postings'], r['host']))

    by_platform = Counter(r['platform'] for r in rows)
    summary = {'scanned_files': files, 'read_failures': failures, 'distinct_hosts': len(rows),
               'platforms': dict(by_platform), 'hosts': rows}
    OUT.write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding='utf-8')

    print(json.dumps({'scanned_files': files, 'read_failures': failures,
                      'distinct_hosts': len(rows), 'platforms': dict(by_platform)}, ensure_ascii=False))
    for row in rows[:60]:
        print(json.dumps(row, ensure_ascii=False)[:200])


if __name__ == '__main__':
    main()
