"""Inspect the request contract of a self hosted employer career site.

Step one support tool: before a bespoke collector is written, this downloads the
campus page, lists its script bundles and reports API looking paths found inside
them, so the collector is implemented against a confirmed contract instead of a
guess. It downloads a bounded number of scripts and never submits anything.
"""
import argparse
import re
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / '.workbuddy/site-contract.txt'
UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36'
PATTERNS = [r'["\'`](/[a-zA-Z0-9_\-/]*api[a-zA-Z0-9_\-/]*)["\'`]',
            r'["\'`](https?://[a-zA-Z0-9.\-]+/[a-zA-Z0-9_\-/]*api[a-zA-Z0-9_\-/]*)["\'`]',
            r'["\'`](/[a-zA-Z0-9_\-/]*(?:position|job|recruit|post|search)[a-zA-Z0-9_\-/]*)["\'`]']


def fetch(url, limit=2_500_000):
    request = urllib.request.Request(url, headers={'User-Agent': UA, 'Referer': url})
    with urllib.request.urlopen(request, timeout=25) as response:
        return response.read(limit).decode('utf-8', 'replace')


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('urls', help='Comma separated pages to inspect')
    parser.add_argument('--scripts', type=int, default=12, help='How many bundles to read')
    args = parser.parse_args()
    lines = []
    for page in [u.strip() for u in args.urls.split(',') if u.strip()]:
        lines.append('=== ' + page)
        try:
            html = fetch(page)
        except Exception as error:
            lines.append('  fetch_failed ' + str(error)[:140])
            continue
        lines.append(f'  html_len={len(html)}')
        title = re.search(r'<title>(.*?)</title>', html, re.S)
        lines.append('  title=' + (title.group(1).strip()[:60] if title else ''))
        scripts = list(dict.fromkeys(urllib.parse.urljoin(page, src)
                                     for src in re.findall(r'<script[^>]+src=["\']([^"\']+)["\']', html)))
        lines.append('  scripts=' + str(len(scripts)))
        # Inline reference to another origin (API gateway) is the strongest signal.
        hosts = sorted({urllib.parse.urlparse(u).hostname for u in re.findall(r'["\'](https?://[^"\']{6,140})["\']', html)
                        if urllib.parse.urlparse(u).hostname})
        lines.append('  inline_hosts=' + ', '.join(hosts[:15]))
        for script in scripts[:args.scripts]:
            lines.append('  script ' + script)
            if not re.search(r'\.js', script):
                continue
            try:
                code = fetch(script)
            except Exception as error:
                lines.append('    js_failed ' + str(error)[:90])
                continue
            hits = set()
            for pattern in PATTERNS:
                for match in re.findall(pattern, code):
                    if len(match) > 3 and not re.search(r'\.(js|css|png|svg|json)$', match):
                        hits.add(match)
            if hits:
                lines.append('    api_like=' + ', '.join(sorted(hits)[:25]))
    OUT.write_text('\n'.join(lines), encoding='utf-8')
    print('\n'.join(lines))


if __name__ == '__main__':
    main()
