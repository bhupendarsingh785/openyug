# OpenYug 2 — Swag/Arjun ka apna agent (Arjun Engine ke dimaag ke saath)

GitHub ke free computer par **har 2 ghante** chalta hai — aur jab bhi `agent/orders.md`
GitHub par badle, **turant**. Phone band ho tab bhi kaam chalta rehta hai.

## Aadesh kaise dein
Phone (Termux) se:  `ai cloud order "sudhaar: report chhoti karo"`
Ya GitHub par `agent/orders.md` mein nayi line: `- [ ] ...`

| Aadesh | Kya hota hai |
|---|---|
| `sudhaar: ...` | apna (OpenYug + engine) code sudhaarta hai → saare tests → **Pull Request** |
| `banao: ...` | `projects/<naam>` mein naya app → tests → **Pull Request** |
| `kaam: ...` | dimaag web/code/tools se koi bhi kaam |
| `agent banao: naam - kaam` | naya sahayak agent (`agent/agents/naam.md`), apne aadesh ke saath |
| `bada kaam: ...` | AI chhote steps ka job banata hai, har run ek step |
| `seekho: ...` | web + AI se seekh kar `knowledge.md` |
| `sujhav: ...` | behtar banane ke idea `suggestions.md` mein |
| `Har baar: ...` | har run chalega |
| koi bhi sawaal | AI jawab report mein |
| `pause` / `resume` | rokna / chalana |

Nateeja: `agent/reports/` — ya phone par `ai cloud`, ya panel mein **Boss** se poochho.

## Taakat kahan se
- **AI:** Arjun Engine ke saare free AI (GitHub Models is workflow ke token se — bina secret;
  baaki keys repo Secrets mein: GEMINI_API_KEY, OPENROUTER_API_KEY, NVIDIA_API_KEY, HF_TOKEN …)
- **Data Kavach:** AI ko bhejne se pehle secrets chhupte hain.
- **Khud-sudhaar:** OpenYug apna code bhi sudhaar sakta hai — tests ke saath, PR mein.
- **Agent banana:** zaroorat ho to apne sahayak agent banata hai (`limits.max_agents` tak).

## Red line (kabhi nahi hat-ti)
- Code **main par seedha kabhi nahi** — branch + Pull Request; **Merge = Swag ki haan**.
- Suraksha files (Kavach, keys, engine, git, tools) aur `.github/workflows` cloud se kabhi nahi badalte.
- AI kabhi raw shell command nahi chala sakta; naya connection / naya tool code cloud mein mana.
- Kisi aur ka account nahi; paisa, delete, public post — bina saaf haan ke nahi.
- Ek run mein AI-budget: `config.json → limits` (bhaari 1, halka 4).

## Files
`run.py` (runner) · `brain.py` (khud faisla) · `spawn.py` (jobs + agents) · `learn.py` (seekhna) ·
`engine.py` (Arjun Engine ka pul) · `clock.py` (ghadi) · `config.json` (sites, limits) ·
`seed/` (pehli yaad — live files pehli run par banti hain)
