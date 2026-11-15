#!/usr/bin/env python3
"""
OpenYug <-> Arjun Engine ka pul (bridge).

OpenYug (Python) yahan se Arjun ke Node engine ko bulata hai:
  ask(q)        -> AI se jawab (6+ free AI ka failover, Data Kavach ke saath)
  khud(text)    -> engine apna/agent ka code sudhaare -> tests -> naya branch + PR
  banao(text)   -> naya app projects/<naam> mein -> tests -> PR
  kaam(text)    -> dimaag (web, padhna, code) se koi bhi kaam

Cloud (GitHub Actions) mein koi insaan "haan" nahi bol sakta, isliye:
  code badlav kabhi main par seedha nahi jaata — hamesha alag branch + Pull Request.
  Swag/Arjun PR dekh kar Merge dabata hai = wahi "haan".
"""
import os, re, shutil, subprocess

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SCRIPT = os.path.join(ROOT, "scripts", "self-upgrade.cjs")
PR_RE = re.compile(r"https://github\.com/[^\s)]+/pull/\d+")


def offline():
    return os.environ.get("OPENYUG_OFFLINE") == "1"


def available():
    return (not offline()) and bool(shutil.which("node")) and os.path.exists(SCRIPT)


def _git(*args):
    try:
        r = subprocess.run(["git", *args], cwd=ROOT, capture_output=True, text=True, timeout=60)
        return r.returncode, (r.stdout or "").strip()
    except Exception as e:
        return 1, str(e)


def _dirty():
    code, out = _git("status", "--porcelain", "--untracked-files=all")
    return set(l[3:].strip().strip('"') for l in out.splitlines() if l.strip()) if code == 0 else set()


def _guard_main(before):
    """Engine ka koi bhi badlav jo PR mein nahi gaya, main par na rahe — wapas purana."""
    for p in sorted(_dirty() - before):
        full = os.path.join(ROOT, p)
        code, _ = _git("ls-files", "--error-unmatch", "--", p)
        if code == 0:
            _git("checkout", "-q", "--", p)
        elif os.path.isfile(full):
            os.remove(full)


def _run(args, timeout):
    """Node engine chalao (cloud mode). Kaam ke baad wapas usi branch par aao."""
    if not available():
        return False, "engine nahi mila (node/scripts) ya offline"
    env = dict(os.environ)
    env.setdefault("ARJUN_CLOUD", "1")
    _, branch = _git("rev-parse", "--abbrev-ref", "HEAD")
    before = _dirty()
    try:
        r = subprocess.run(["node", SCRIPT, *args], cwd=ROOT, capture_output=True, text=True,
                           timeout=timeout, env=env, stdin=subprocess.DEVNULL)
        ok, out = r.returncode == 0, (r.stdout or "") + ("\n" + r.stderr if r.stderr else "")
    except subprocess.TimeoutExpired:
        ok, out = False, f"time-limit ({timeout // 60} min) paar — agli baar"
    except Exception as e:
        ok, out = False, str(e)
    # engine PR ke liye naya branch bana sakta hai — report main par hi likhni hai
    if branch and branch != "HEAD":
        _, now = _git("rev-parse", "--abbrev-ref", "HEAD")
        if now != branch:
            _git("checkout", "-q", branch)
        if args and args[0] in ("khud", "banao", "kaam"):
            _guard_main(before)
    return ok, out


def tail(text, n=8):
    lines = [l for l in str(text).strip().splitlines() if l.strip()]
    return "\n".join(lines[-n:])


def pr_link(text):
    m = PR_RE.findall(str(text))
    return m[-1] if m else ""


def ask(question, timeout=240, web=False):
    ok, out = _run(["ask", "--web" if web else "--no-web", question], timeout)
    if not ok:
        return ""
    # stdout = jawab; stderr lines (🤖 jawab: …) hata do
    ans = [l for l in out.splitlines() if not l.strip().startswith(("🤖", "↪", "🛡️", "🌐"))]
    return "\n".join(ans).strip()


def khud(text, timeout=1500):
    return _run(["khud", text], timeout)


def banao(text, folder, timeout=1500):
    return _run(["banao", text, "--root", folder], timeout)


def kaam(text, timeout=1200):
    return _run(["kaam", text, "--root", ROOT], timeout)
