#!/usr/bin/env python3
"""Smoke test for the live site. Run by .github/workflows/smoke.yml after every production
deploy and once a day. Prints one line per check and exits 1 if any check fails; the
workflow then opens (or updates) a GitHub issue labelled smoke-alert, which emails you."""
import json, re, sys, urllib.request, urllib.error

UA = {"User-Agent": "smoke-test (+github actions)"}
results = []

def get(url, timeout=30):
    req = urllib.request.Request(url, headers=UA)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, r.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode("utf-8", "replace")
    except Exception as e:  # DNS, TLS, timeout
        return 0, str(e)

def check(name, ok, detail=""):
    results.append((name, bool(ok), detail))

def finish():
    bad = [r for r in results if not r[1]]
    for name, ok, detail in results:
        print(("PASS " if ok else "FAIL ") + name + (f" ({detail})" if detail else ""))
    with open("smoke-report.md", "w") as f:
        f.write("| Check | Result | Detail |\n|---|---|---|\n")
        for name, ok, detail in results:
            f.write(f"| {name} | {'✅' if ok else '❌'} | {detail.replace('|', '/')} |\n")
    sys.exit(1 if bad else 0)

BASE = (sys.argv[1] if len(sys.argv) > 1 else "https://foundeck.vercel.app").rstrip("/")

s, html = get(BASE + "/")
check("App loads", s == 200 and "Foundeck" in html, f"HTTP {s}")
m = re.search(r'<meta property="og:image" content="([^"]+)"', html)
check("WhatsApp preview image set", bool(m))
if m:
    s3, _ = get(m.group(1)); check("WhatsApp preview image loads", s3 == 200, f"HTTP {s3}")
scripts = re.findall(r'<script[^>]+src="(/assets/[^"]+\.js)"', html)
js = "".join(get(BASE + x)[1] for x in scripts[:2])
keys = set(re.findall(r"AIza[0-9A-Za-z_-]{35}", js))
# One AIza key is expected (the public Firebase web key). A second one would be a leaked Gemini key.
check("No extra Google/Gemini key in the app's JavaScript", len(keys) <= 1, f"{len(keys)} AIza keys")
# The free-upgrade test endpoint must stay switched off in production.
req = urllib.request.Request(BASE + "/api/test-upgrade", data=b'{"userId":"smoke"}', headers={**UA, "Content-Type": "application/json"}, method="POST")
try:
    with urllib.request.urlopen(req, timeout=30) as r:
        code = r.status
except urllib.error.HTTPError as e:
    code = e.code
except Exception:
    code = 0
check("Test upgrade endpoint is off (404)", code == 404, f"HTTP {code}")
finish()
