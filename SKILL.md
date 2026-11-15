---
name: khud-sudhaar
description: >
  Self-improvement. Use when the owner says "khud ko sudharo", "aur advance
  bano", "naya skill seekho", "improve yourself", or when the same mistake or
  missing ability shows up twice in memory/lessons.md. Creates new skills,
  connects new free MCP tools, and proposes upgrades — with owner approval.
---

# Khud Sudhaar — get better over time

## What you may do on your own

1. Read `memory/lessons.md` and recent failed/blocked tasks. Find repeated
   problems ("3 baar image blurry aayi", "site X always blocks").
2. Write a NEW skill for a repeated workflow:
   - Create `skills/<short-name>/SKILL.md` in the company skill library
     (Paperclip → Skills → New), with `name`, `description` (when to use) and
     clear numbered steps. Add a `scripts/` file if code helps.
   - Test it once on a small real task, then record the result in `lessons.md`.
3. Improve your own instructions by adding a short rule to your memory
   (`lessons.md`), not by rewriting other agents' instructions.
4. Research better free tools with `duniya-search` (GitHub stars, last update,
   licence) and add good ones to `memory/tools.md`.

## Self-Development Engine (Arjun's engine) — change code safely

For changing code of a project (including your own tools/skills), use the engine
in `scripts/` instead of editing files by hand. It reads the project, asks the
AI model for a plan, blocks unsafe paths (.env, .git, secrets, outside folder),
checks syntax, backs up, applies, runs tests, and rolls back + retries with the
error if tests fail.

```bash
S="$SKILL_DIR/scripts"
node "$S/self-upgrade.cjs" status --root <project>
node "$S/self-upgrade.cjs" propose "<what to improve>" --root <project> --focus word1,word2
#   -> prints proposal id + summary + diff. Nothing is written.
#   -> post the summary + diff to the owner (task comment) and set the task to blocked.
node "$S/self-upgrade.cjs" apply <proposalId> --root <project>   # ONLY after owner says "haan"
node "$S/self-upgrade.cjs" restore <backupId> --root <project>   # undo
```

Models (world-wide, see `node "$S/self-upgrade.cjs" models`): USA (Gemini, OpenAI,
Claude, Grok, Groq, Cerebras), China (DeepSeek, Qwen, Kimi, GLM), India (Sarvam,
Krutrim), Europe (Mistral), free gateways (OpenRouter, NVIDIA, Hugging Face,
GitHub Models) and Ollama offline. Default `--provider auto` uses every key that
is set, free first, and fails over to the next one on error, quota, timeout or an
unusable reply. Pick one with `--provider deepseek`, or an order with
`--provider gemini,sarvam,claude`. Add future models in `~/.arjun-ai/providers.json`.
Web: add `--web` to `run`/`propose`, or `ask "<question>" --web` for research.
If no key exists, use `connection-advisor` (free option: Gemini key or Ollama).

Data Kavach (always on): before any text goes to an outside AI, keys, tokens,
passwords, private keys, emails, phone and card numbers are replaced by
`[[KAVACH_n]]` placeholders and put back in the reply. Sent sizes (never content)
are logged in `~/.arjun-ai/sent-log.jsonl`. `--private` (or `SELF_DEV_PRIVATE=1`)
allows only on-device models (Ollama) so nothing leaves the device. Use private
mode for anything the owner calls personal.

## Dimaag, tools, gateway, GitHub (same scripts folder)

```bash
node "$S/self-upgrade.cjs" backup | restore              # encrypted backup of everything personal (GitHub/Downloads)
node "$S/self-upgrade.cjs" phone info|apps|halka|wapas   # owner's own phone via ADB (no root); reversible only
node "$S/self-upgrade.cjs" cloud [order ".."]               # ☁️ OpenYug: GitHub par chalne wala agent (agent/README.md)
node "$S/self-upgrade.cjs" panel                          # 💬 Boss inbox (chat about status/activity) + owner's red DIMAAG button (edit/improve/rollback the brain script)
node "$S/self-upgrade.cjs" khud "<improvement>"                # engine improves ITSELF (own tests = safety net)
node "$S/self-upgrade.cjs" banao "<app>" --root <new-folder>   # new software from scratch, with tests
node "$S/self-upgrade.cjs" kaam "<goal>" --root <project>   # plans and acts step by step: web, files, change_code,
                                                            # tools, new tools, ask owner; learns lessons (yaad)
node "$S/self-upgrade.cjs" connect search "<need>"          # find tools: catalog + MCP servers (npm) + GitHub
node "$S/self-upgrade.cjs" connect add <catalog-name>       # or: connect http|command|mcp <name> ...
node "$S/self-upgrade.cjs" tool run <name> '<json>'         # use a connected tool
node "$S/self-upgrade.cjs" tool banao <name> "<what>"       # AI writes a new function; saved only after owner's haan
node "$S/self-upgrade.cjs" gateway                          # local OpenAI-compatible AI at http://127.0.0.1:4141/v1
node "$S/self-upgrade.cjs" github clone owner/repo          # bring a GitHub project; upgrades then auto-branch,
                                                            # commit, push and open a PR (never touches main)
node "$S/self-upgrade.cjs" doctor                           # health check with fixes
```

In the dashboard, an OpenCode agent can use every connected AI through the gateway
with model `arjun/arjun-auto` (the phone start script sets this up).

Never run the engine with approval turned off, and never apply a proposal the
owner has not approved. Self-check the engine anytime: `node "$S/engine.test.cjs"`.

## What needs the owner's "haan" first

Create a task assigned to the owner (or post a comment and set `blocked`) with a
short Hinglish summary, then wait:

- Installing new software or MCP servers on the machine.
- Changing another agent's instructions, budget, or model.
- Hiring new agents (use `paperclip-create-agent` after approval).
- Anything that costs money, needs an account, or sends data outside.
- Changing this app's own source code (open it as a task for the engineering
  agent; changes go through a branch + review, never straight to `master`).

## Adding a new MCP tool (free ones first)

1. Find it: `node skills/duniya-search/scripts/search.mjs github "mcp server <need>"`.
2. Check: open source licence, updated in the last 6 months, no unknown binary
   downloads, does not ask for more permissions than needed.
3. Propose to the owner: name, link, what it adds, what access it needs.
4. After "haan": add it to the agent's adapter config and note it in `memory/tools.md`.

## Weekly self-review (if a recurring task exists)

Every week write `memory/weekly-review.md`: top 3 lessons, skills created, tools
added, what still fails, one proposal for the owner.
