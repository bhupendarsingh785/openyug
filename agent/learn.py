#!/usr/bin/env python3
"""
OpenYug — seekhne wala hissa.
1) web se naya laata hai (ya diya hua topic)  2) Arjun Engine ke AI se chhota sabak
3) knowledge.md mein jodta hai  4) score naapta hai
AI na mile to sirf headlines likhta hai (kabhi rukta nahi).
"""
import json, os, re, urllib.request, urllib.parse, datetime, sys, importlib.util

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
A = os.path.join(ROOT, "agent")
KNOW = os.path.join(A, "knowledge.md")
STATE = os.path.join(A, "state.json")
NOW = datetime.datetime.now(datetime.timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")

SOURCES = [
    "https://hnrss.org/newest",
    "https://github.blog/changelog/feed/",
]


def _engine():
    spec = importlib.util.spec_from_file_location("engine", os.path.join(A, "engine.py"))
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


def fetch(url, timeout=20):
    if os.environ.get("OPENYUG_OFFLINE") == "1":
        return ""
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "openyug-agent"})
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.read().decode("utf-8", "ignore")
    except Exception:
        return ""


def titles(xml, n=12):
    out = []
    for m in re.finditer(r"<title>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?</title>", xml, re.S):
        t = re.sub(r"\s+", " ", m.group(1)).strip()
        if t and len(t) > 12 and "Hacker News" not in t and t != "GitHub" and not t.startswith("Archive:"):
            out.append(t)
    return out[:n]


def load_state():
    try:
        return json.load(open(STATE, encoding="utf-8"))
    except Exception:
        return {"paused": False, "learn_count": 0, "last_learn": None, "score": 0, "history": []}


def save_state(st):
    json.dump(st, open(STATE, "w", encoding="utf-8"), ensure_ascii=False, indent=2)


def learn(topic="", ai=None):
    """Wapas: (ok, chhota sandesh). ai(prompt) -> text (Arjun Engine); None = bina AI."""
    st = load_state()
    if st.get("paused"):
        return False, "⏸️ paused"
    if topic:
        got = [topic]
        prompt = (f"'{topic}' ke baare mein aaj ki sabse kaam ki jaankari 3-5 line mein, simple Hinglish mein do — "
                  "developer/creator ke liye kya kaam ka hai. Ant mein source links.")
    else:
        got = []
        for s in SOURCES:
            got += titles(fetch(s), 8)
        got = list(dict.fromkeys(got))[:14]
        if not got:
            return False, "Aaj kuch naya nahi mila (net issue)."
        prompt = ("In headlines ko padho aur Hinglish me 3 line ka sabak do — "
                  "kya naya hai aur developer ke liye kya kaam ka hai:\n- " + "\n- ".join(got[:8]))
    sabak = ""
    if ai:
        try:
            sabak = (ai(prompt) or "").strip()
        except Exception:
            sabak = ""
    if not sabak and topic:
        return False, "AI abhi busy — topic agli baar seekhunga"
    block = [f"\n## {NOW[:10]} — seekha: {topic or f'{len(got)} cheezein'}", ""]
    if not topic:
        block += [f"- {g}" for g in got]
    block += ["", "**Sabak:** " + (sabak.replace("\n", " ")[:900] if sabak else "(AI se sabak nahi bana — sirf headlines)"), ""]
    with open(KNOW, "a", encoding="utf-8") as f:
        f.write("\n".join(block))
    st["learn_count"] = st.get("learn_count", 0) + 1
    st["last_learn"] = NOW
    st["score"] = min(100, st.get("score", 0) + (3 if sabak else 1))
    st.setdefault("history", []).append({"at": NOW, "headlines": len(got), "sabak": bool(sabak), "topic": topic[:80]})
    st["history"] = st["history"][-50:]
    save_state(st)
    return True, f"📚 seekha ({'sabak ke saath' if sabak else 'sirf headlines'}) · score {st['score']}/100 · {st['learn_count']} baar"


def main():
    eng = _engine()
    topic = " ".join(sys.argv[1:]).strip()
    ai = (lambda q: eng.ask(q, web=bool(topic))) if eng.available() else None
    ok, msg = learn(topic, ai)
    print(msg)


if __name__ == "__main__":
    main()
