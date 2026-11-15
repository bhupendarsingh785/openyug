#!/usr/bin/env python3
"""
OpenYug — agent jo agent banata hai.

1) Job: bada kaam -> AI chhote steps mein todta hai -> agent/jobs/<id>.json
   Har step sirf in mein se ek ho sakta hai (raw shell kabhi nahi):
     known: tests | data | sites | cleanup | mirrors     (local, bina AI)
     ask:   <sawaal>                                    (AI jawab)
     khud:  <apna code sudhaar>                          (tests + PR)
     banao: <naya app>                                   (tests + PR)
     kaam:  <goal>                                       (dimaag)
2) Sub-agent: `agent banao: naam - kaam` -> agent/agents/<naam>.md
   Har agent ka apna kaam (role) aur apne aadesh hote hain; runner har run
   har agent ka ek aadesh chalata hai. Agent bhi naye agent bana sakta hai
   (config.json -> limits.max_agents tak).

Chalana:  python3 agent/spawn.py "tests aur data check karo"
          python3 agent/spawn.py --agent "youtube - Toonistaan ke video ideas"
"""
import json, os, sys, time, re, datetime

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
A = os.path.join(ROOT, "agent")
JOBS = os.path.join(A, "jobs")
AGENTS = os.path.join(A, "agents")
KINDS = {"known", "ask", "khud", "banao", "kaam"}
KNOWN_NAMES = {"tests", "data", "sites", "cleanup", "mirrors"}


def _limits():
    try:
        return json.load(open(os.path.join(A, "config.json"), encoding="utf-8")).get("limits", {})
    except Exception:
        return {}


def rule_plan(goal):
    """Bina AI — purana tareeka (Swag ka original)."""
    g = goal.lower()
    steps = []
    if "test" in g or "jaanch" in g: steps.append({"kind": "known", "text": "tests"})
    if "data" in g or "market" in g: steps.append({"kind": "known", "text": "data"})
    if "site" in g or "health" in g or "platform" in g: steps.append({"kind": "known", "text": "sites"})
    if "seekh" in g or "learn" in g or "naya" in g: steps.append({"kind": "ask", "text": f"Is kaam ke liye kya seekhna zaroori hai: {goal}"})
    if not steps:
        steps = [{"kind": "ask", "text": f"Is kaam ka 3 step plan Hinglish mein: {goal}"}, {"kind": "known", "text": "tests"}]
    return steps


def parse_steps(raw):
    """AI ka JSON -> sirf safe steps. Galat/anjaan sab hata do."""
    m = re.search(r"\[[\s\S]*\]", raw or "")
    if not m:
        return []
    try:
        arr = json.loads(m.group(0))
    except Exception:
        return []
    out = []
    for s in arr if isinstance(arr, list) else []:
        if not isinstance(s, dict):
            continue
        kind, text = str(s.get("kind", "")).strip().lower(), str(s.get("text", "")).strip()[:400]
        if kind not in KINDS or not text:
            continue
        if kind == "known" and text not in KNOWN_NAMES:
            continue
        out.append({"kind": kind, "text": text})
    return out[:6]


def plan(goal, ai=None):
    if ai:
        raw = ai(
            "Is bade kaam ko 2-6 chhote steps mein todo. Sirf JSON array do, aur kuch nahi. "
            'Har step: {"kind": "...", "text": "..."}. kind sirf: '
            "known (text sirf: tests|data|sites|cleanup|mirrors), ask (sawaal/likhna), "
            "khud (OpenYug/engine ka apna code sudhaarna), banao (naya app), kaam (koi bhi goal). "
            "Code badalne wale steps kam rakho (max 2).\n\nKaam: " + goal)
        steps = parse_steps(raw)
        if steps:
            return steps
    return rule_plan(goal)


def spawn(goal, ai=None):
    os.makedirs(JOBS, exist_ok=True)
    jid = time.strftime("%Y%m%d-%H%M%S")
    steps = plan(goal, ai)
    job = {
        "id": jid,
        "goal": goal,
        "created": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "steps": [{"name": s["text"][:60], "kind": s["kind"], "text": s["text"], "done": False} for s in steps],
    }
    p = os.path.join(JOBS, jid + ".json")
    json.dump(job, open(p, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
    print(f"🧩 Job bana: {jid} — {len(steps)} steps")
    return p


def slug(text):
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")[:30] or "agent"


def create_agent(spec, ai=None):
    """'naam - kaam' (ya 'naam: kaam') -> agent/agents/<naam>.md. Wapas: (ok, msg, done)."""
    m = re.match(r"\s*([^\-–:]+?)\s*[\-–:]\s*(.+)", spec or "")
    if not m:
        return False, "Aise likho: agent banao: naam - uska kaam", True
    name, role = slug(m.group(1)), m.group(2).strip()[:300]
    os.makedirs(AGENTS, exist_ok=True)
    existing = [f for f in os.listdir(AGENTS) if f.endswith(".md") and f != "README.md"]
    path = os.path.join(AGENTS, name + ".md")
    if os.path.exists(path):
        return True, f"Agent '{name}' pehle se hai — uske aadesh agent/agents/{name}.md mein", True
    if len(existing) >= int(_limits().get("max_agents", 12)):
        return False, f"Agent ki seema ({len(existing)}) poori — pehle koi purana agent hatao", True
    first = []
    if ai:
        raw = ai(f"Ek naya sahayak agent ban raha hai. Kaam: {role}\nIske liye 3 pehle aadesh do, har ek nayi line par '- [ ] ' se shuru. "
                 "Aadesh in roop mein ho sakte hain: 'seekho: ...', 'sujhav: ...', 'likho: ...', 'bada kaam: ...'. Sirf 3 lines.")
        first = [l.strip()[6:].strip() for l in str(raw).splitlines() if l.strip().startswith("- [ ]")][:3]
    if not first:
        first = [f"likho: '{role}' ke liye 3 line ka plan", f"seekho: {role}"]
    body = [f"# Agent: {name}", f"kaam: {role}", f"banaya: {datetime.date.today().isoformat()} (OpenYug)", "",
            "Is agent ke aadesh neeche jodo (`- [ ] ...`). Har run ek aadesh chalta hai.", "", "## Aadesh"]
    body += [f"- [ ] {x}" for x in first]
    open(path, "w", encoding="utf-8").write("\n".join(body) + "\n")
    return True, f"🤖 Naya agent '{name}' bana ({len(first)} aadesh ke saath): agent/agents/{name}.md", True


if __name__ == "__main__":
    args = sys.argv[1:]
    if args[:1] == ["--agent"]:
        print(create_agent(" ".join(args[1:]))[1])
    elif args:
        spawn(" ".join(args))
    else:
        print("Kaam bolo: python3 agent/spawn.py 'tests aur data check karo'  |  --agent 'naam - kaam'")
        sys.exit(1)
