# SAT Bluebank — handoff

Written 2026-08-19. A local Bluebook-style SAT practice app over the official
College Board question bank, with auto-grading and College Board's own
explanations, including per-choice "why the answer you picked is wrong".

Everything under **Verified** was run against the live API or the built app on
2026-08-19. Anything not confirmed is called out explicitly. Don't trust the
unverified items without re-checking.

---

## 1. Where things stand

**Working end to end.** Backend is complete and verified; the frontend has all
the functionality and has had one UI pass against Bluebook screenshots plus a
second pass toward OnePrep's cleaner chrome.

```
python -m satbluebank serve      # http://localhost:8000
```

If the bank isn't built yet: `python -m satbluebank build` (~5 min), then
`cd web && npm install && npm run build`.

Frontend dev with hot reload: `python -m satbluebank serve` in one terminal,
`cd web && npm run dev` in another (Vite on :5173 proxies /api to :8000).

| | Count |
|---|---|
| Questions in the local DB | 3,767 live, 0 retired |
| Answer keys recovered from rationale text | 81 |
| Questions with no answer key | **0** |
| MCQs with per-choice explanations | 3,301 of 3,303 |
| Questions flagged by the normalizer | **3** (all genuine source defects, §6) |
| Backend tests | 29 passing |
| Frontend tests | 12 passing |
| Local data on disk | 43 MB `raw/`, 47 MB `data/` (both gitignored) |
| Code | ~1,780 lines Python, ~1,690 lines TypeScript |

Attempts, annotations, and marks tables are empty. Test data was cleared.

---

## 2. The API (verified 2026-08-19)

Three endpoints, **no authentication of any kind**. Confirmed with bare `curl`
sending only `Content-Type`.

```
POST https://qbank-api.collegeboard.org/msreportingquestionbank-prod/questionbank/digital/get-questions
     {"asmtEventId": 99, "test": 1, "domain": "INI,CAS,EOI,SEC"}   # 1 = RW, 2 = Math
POST .../questionbank/digital/get-question   {"external_id": "..."}
GET  https://saic.collegeboard.org/disclosed/{ibn}.json            # returns a 1-element array
```

Math domains are `H,P,Q,S`. `difficulty` is E/M/H; `score_band_range_cd` is 1–7
and strictly finer grained, so prefer it for adaptive logic.

### CORS is wide open (verified, and it decides the architecture)

All three endpoints return `Access-Control-Allow-Origin: *`, and the POST
preflight passes with `Content-Type` in `Access-Control-Allow-Headers`. **A
browser on any origin can fetch the entire bank**, which is what makes a
static GitHub Pages build possible with no server and no proxy.

Verified at the header level with `curl`, including an explicit `OPTIONS`
preflight. **Not** verified in a live browser — the Chrome extension was not
connected during the session. The headers are exactly what a browser checks,
so this is strong but not first-hand.

### Export cost (measured)

3,770 requests at concurrency 5 ran at **12.8 req/s with zero errors**, about
5 minutes total. Raw JSON is **43 MB** on disk. The previous handoff estimated
40–80 MB; the real figure is 43 MB.

---

## 3. Corrections to the previous handoff

Three things the earlier handoff got wrong. All are fixed in code, but know
them before trusting old notes.

1. **The `ibn` stimulus lives in a separate `body` field**, not folded into
   `prompt`. It is present on **218** of the 459 legacy items and carries the
   table, figure, or expression the stem refers to. Dropping it leaves
   questions reading "Which of the following is equivalent to the expression
   above?" with no expression. This was a live bug in the normalizer.
2. **3,770 index entries are only 3,767 distinct questions.** Three
   `external_id`s appear twice under different `questionId`s with different
   `updateDate`s. Pass 1 collapses to the newest.
3. Payload size is 43 MB, not a 40–80 MB range.

One item is now confirmed that was previously unverified: the `ibn` MCQ
`choices` keys. All 389 were checked, and any deviation from `A`–`D` is
flagged as `unexpected_choice_labels`. Nothing flagged.

---

## 4. Bugs that were fixed, and why the guards exist

These are the ones worth remembering, because two of them silently produced
**wrong answer keys**, which is worse than a missing one: it teaches you the
wrong thing and you never notice.

| Bug | Effect |
|---|---|
| `.strip(".")` on a recovered SPR answer | Turned the answer `.1667` into `1667`. Was live in the DB before it was caught. Fixed to `rstrip` only |
| `([^.]+?)` in the SPR pattern | Cannot cross a decimal point, so "The correct answer is 0.25." captured `0` |
| `re.findall("[A-D]", "A, B, and C", IGNORECASE)` | Also matches the **a** and **d** in "and", producing phantom duplicate boundaries |
| `{_SP}?` where `_SP` is `(?:...)+` | Compiles to lazy one-or-more, not optional, silently breaking the whole grouped-rejection pattern |

The tests in `tests/test_backend.py` pin every one of these. Each case is a
shape that actually occurs in the bank, with the question id in a comment.
**Do not loosen them without re-running the corpus-wide cross-check.**

### The cross-check that catches key errors

`normalize` asserts that exactly one per-choice explanation reads as "correct"
and that it is the keyed choice. Across the whole corpus that agrees on
**3,301 of 3,303** MCQs. The two exceptions are real defects (§6) and their
per-choice mapping is deliberately dropped.

---

## 5. Rationale parsing: the variations that actually occur

`rationale.py` splits one rationale blob into `{letter: html}`. It cuts the
**HTML**, not flattened text, so MathML and inline SVG survive, and each
segment is re-balanced because cuts land mid-paragraph.

Real variations it handles, all found in the bank:

- `&nbsp;` inside `Choice A&nbsp;is`
- The letter wrapped in a tag: `Choice <span class="italic">C</span> is`
- Grouped rejections: `Choices A, B, and C are incorrect`
- Singular-with-a-list typo: `Choice B, C, and D are incorrect`
- Adverbs: `are also incorrect`
- Missing verb: `Choice B incorrect.`
- Adverb-folded: `Choice C incorrectly limits the cost`
- `<p>Incorrect Answer Rationale<br>` headers with no terminating period
- Sentences ending in a closing quote: `...and "works."</p><p>Choice B is...`

And two shapes it must **not** treat as boundaries:

- `...choice D is the only graph that passes through the point...` (mid-sentence)
- `Choices B and D show models of the form...` (plural reference, not a rejection)

Individual explanations beat grouped ones. A letter mentioned twice at sentence
start is a self-reference, and the first segment is kept whole rather than
truncated at the reference.

---

## 6. The 3 flagged questions

Run `python -m satbluebank audit`. A healthy corpus reports exactly 3, all
defects in College Board's own text:

| Question | Flag | What's wrong |
|---|---|---|
| `5904d2e1-1ae5-40cf-915f-050b6b6d3111` | `missing_explanations_A` | The rationale never mentions choice A at all |
| `4e92e788-6fae-4f7c-a838-84939a7bdd2f` | `explanation_key_mismatch_rationale_says_D` | Prose says "Choice D is correct" but the key and `keys[]` uuid both say A. The options were reordered and the prose wasn't updated |
| `bc24a37b-b601-44de-a222-60974e9db0fb` | `explanation_key_mismatch_rationale_says_C` | Same, key is B |

For the two mismatches the per-choice mapping is dropped and the full
rationale is shown instead. Left unguarded, these tell a student who picked D
that they were right.

---

## 7. Architecture: where it landed and what's next

**Decided:** ship the exporter, never the data. The repo is code only; the
bank is fetched on first run into gitignored local storage.

**Current shape:** Python backend (stdlib only, zero dependencies) serving a
JSON API plus the built React frontend. Local only.

**Agreed next step, not started:** port the backend to TypeScript so the whole
thing runs as a **static GitHub Pages site**. The user has approved this
("typescript is fine").

What the port involves, roughly 600–700 lines:

| Module | Port notes |
|---|---|
| `rationale.py` (267 lines) | Pure regex and string slicing, ports close to 1:1. **The risky one** — port the 29 tests first and treat them as the spec |
| `grading.py` (101 lines) | Needs exact rational arithmetic. Python's `Fraction` becomes a small BigInt fraction helper, ~30 lines. Floats would break `3/17` comparisons |
| `pipeline.py` (376 lines) | Index/fetch/normalize; SQLite writes become IndexedDB |
| `session.py` | With only 3,767 questions, hold the index in memory and filter in JS rather than porting the SQL |
| `server.py` | Deleted entirely |

Pages specifics: repo must be public (fine, code only), Vite needs
`base: '/SAT-Bluebank/'` unless a custom domain is pointed at it, and the app
should call `navigator.storage.persist()` so 43 MB in IndexedDB isn't evicted.

**What is lost on Pages:** the answer key has to live in the browser, so it
can't be withheld until you answer the way the server version does. It stays
hidden in the UI, just not cryptographically. Irrelevant for personal use.

### Cross-device sync, designed but not built

Decided approach for when progress needs to move between machines:

**One file per device, all in one cloud-synced folder.** Each device only ever
writes its own `device-<id>.jsonl` and reads all of them, so there is no write
conflict and no "conflicted copy" from OneDrive or Dropbox. Merge is a replay:

- **Attempts** are append-only and union trivially.
- **Flags and annotations** are last-write-wins per question by timestamp.

Written from the browser via the File System Access API (`showDirectoryPicker`,
handle stashed in IndexedDB). Chrome and Edge only; Firefox and Safari fall
back to manual export/import. Needs a secure context, so https or localhost
but not plain http on a LAN IP.

**Do this before accumulating history:** `attempts.id` is an autoincrementing
integer, which is per-database, so two machines both create id 5 and merging
would silently drop attempts. It needs a UUID per attempt. It is a one-line
schema change and **the attempts table is currently empty**, so it costs
nothing right now and becomes a migration later.

---

## 8. UI state

Two passes done. Reference screenshots are in `reference/` (gitignored).

**Matched from Bluebook:** split pane with draggable divider for Reading and
Writing (Math figures go inline above the question, as the real app does),
numbered badge, Mark for Review, cross-out tool, timer with Hide, question
navigator, Directions sheet.

**Then moved toward OnePrep** on user feedback that it looked old: removed the
"THIS IS A PRACTICE TEST" banner, the dashed rules, and the colored bands.
Chrome is now white with hairline borders. All Unicode glyphs were replaced
with a hand-rolled 24×24 stroke icon set in `web/src/components/Icon.tsx` (17
icons, no dependency).

**Home page** (`components/Home.tsx`) replaces the old top filter bar: section
cards, domain and skill selects, difficulty and history pills, live count,
sticky start bar. "Go back" in the practice header returns to it.

**Navigator colors**, specified by the user:

| State | Color |
|---|---|
| Unanswered | White, dashed border |
| Right first try | Green **(assumed — user never specified this one)** |
| Right after 2+ tries | Yellow |
| Latest attempt wrong | Red |

All four verified by driving real attempts through the API. This needed an
`attempt_count` in `question_set`, which is now returned.

**Cross-out toggle** is on by default, per user request.

### Open UI decisions

1. **Font.** Currently Inter for chrome, Source Serif 4 for question content,
   both Google Fonts. Swapping is one line: `--sans` in `styles.css`. The user
   asked for options and was given: Inter, Geist, Plus Jakarta Sans, DM Sans,
   Manrope, Satoshi, IBM Plex Sans, or a system stack. **No choice made yet.**
   Note the user asked for sans; the recommendation was to keep serif for
   passage text because Bluebook and OnePrep both do and it reads better.
2. **Green for first-try-correct** was assumed, never confirmed.

### Known fidelity gaps

- Icons are hand-rolled and approximate, not Bluebook's actual set.
- The user's last message said "the interface is weird" generally. The second
  pass addressed banner, rules, glyphs, fonts, and the home page, but has
  **not been seen by the user yet.** Expect more feedback.

---

## 9. Gotchas

- **`data/`, `raw/`, and `reference/` are gitignored.** No College Board
  content and no screenshots should ever be committed.
- **A screenshot was accidentally committed** in `18782fd` and is still in git
  history. Deleting the file later does not remove it. The repo has to be
  public for Pages. Rewriting history or squashing to a fresh initial commit
  are the options; this is the user's call and the user runs all git commands.
- **The user runs all git operations.** Do not commit, push, or set remotes.
  Remote is `https://github.com/jackwangxyw/SAT-Bluebank.git`.
- **Windows:** set `PYTHONIOENCODING=utf-8` before any command that prints
  question text, or cp1252 will throw on the unicode minus sign.
- **Backgrounding in Git Bash:** `cd x && python … &` backgrounds the whole
  chain, so later commands in the same call run from the original directory.
  It is easy to end up with several stacked servers on one port. Kill them via
  PowerShell `Get-CimInstance Win32_Process` filtered on the command line, not
  `pkill`.
- **Highlight offsets** are measured over text nodes only, skipping math,
  SVG, and images. That is what lets MathJax replace every `<math>` with
  generated SVG without moving a highlight. There is an explicit test that
  simulates exactly that. Don't "simplify" the opaque-element skip.
- MathJax is vendored at `web/public/mathjax/mml-svg.js` (1.9 MB). SVG output
  means no font files, so it works offline. Don't swap it for a CDN build.
- Desmos loads lazily from its CDN on first calculator open, using the demo API
  key from their docs. Nothing else in the app needs the network once built.

---

## 10. File map

```
satbluebank/
  api.py         3 endpoints, retry, no auth
  db.py          SQLite schema: questions, attempts, annotations, marks
  pipeline.py    pass 1 index, pass 2 fetch (resumable), pass 3 normalize
  rationale.py   per-choice explanation splitting + answer-key recovery
  grading.py     answer canonicalization + membership/rational matching
  session.py     practice logic, question sets, taxonomy, stats
  server.py      stdlib HTTP API + serves web/dist
  cli.py         index/fetch/normalize/build/serve/stats/show/answer/audit/import
tests/           29 backend tests
web/src/
  App.tsx        shell, home/practice routing, keyboard
  api.ts         ~50-line API client; the whole data layer sits behind this
  types.ts
  components/    Home, QuestionView, Navigator, Explanation, RichText, Icon, Desmos
  lib/ranges.ts  highlight anchoring (+ ranges.test.ts, 12 tests)
  lib/useTimer.ts per-question timer, pauses when tab hidden
  styles.css     all styling; --sans at the top swaps the typeface
reference/       Bluebook + OnePrep screenshots, gitignored
```

---

## 11. Suggested next actions

1. Confirm the font and the first-try-correct color.
2. Let the user look at the current UI and collect the next round of feedback.
3. Add the attempt UUID while `attempts` is still empty.
4. Do the TypeScript port for GitHub Pages, tests first.
5. Decide what to do about the screenshot in git history before the repo gets
   any traffic.
