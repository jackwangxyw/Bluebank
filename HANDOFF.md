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
the functionality and has had four UI passes (§8), the last of which was
checked in a rendered browser (§9 says how).

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
| Backend tests | 32 passing |
| Frontend tests | 57 passing |
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

**Done (2026-08-19):** the backend is ported to TypeScript and the static
GitHub Pages build works end to end. Both backends are kept. See section 7c.

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

## 7b. Practice set ordering (added 2026-08-19)

The default order is **`shuffled`**, not `natural`. Natural ordering is
`section, domain, skill, difficulty, id`, and because `MATH` sorts before `RW`
that put **all 1,922 Math questions before the first Reading one**, with every
Easy question ahead of every Hard one inside each skill. Verified against the
live bank: the first RW question sat at index 1922.

`db.shuffle_key(question_id)` is a `blake2b` digest of the id, masked to 63
bits, registered on the connection as a deterministic SQLite function and used
as `ORDER BY shuffle_key(q.id)`.

Why a hash of the id rather than a stored shuffle or a seeded RNG:

- **Numbering stays put.** The same pool always comes back in the same order,
  so "question 40" means the same question tomorrow, after a rebuild, and on
  another machine. Verified across repeat calls, fresh connections, and
  separate processes.
- **Nothing to store.** No seed column, no migration, and it survives the
  planned TypeScript/IndexedDB port unchanged (`blake2b` is in WebCrypto only
  as SHA, so use SHA-256 there and re-pin the test literals deliberately).
- **Pool updates barely disturb it.** New questions slot into the hash order;
  existing questions keep their relative order instead of the whole set
  renumbering.

Measured after the change: first 100 questions are 56 Math / 44 RW against a
bank that is 51% Math, and difficulties interleave.

**Do not use the builtin `hash()`** for this. Python randomises string hashing
per process unless `PYTHONHASHSEED` is set, so the set would reshuffle on every
server restart, which is the exact failure this design avoids.
`tests/test_backend.py::TestShuffleKey` pins two literal key values. If those
ever change, every question number silently points somewhere else, so that test
must fail loudly rather than be updated to match new output.

`order=natural|difficulty|id` still work as explicit query parameters.

---

## 7c. Two backends: localhost and GitHub Pages

Both work. Everything in the app goes through `web/src/api.ts`, which is a
picker; nothing else in the frontend touches the network or storage.

| | `apiHttp.ts` (localhost) | `apiLocal.ts` (Pages) |
|---|---|---|
| Data | Python server + SQLite | College Board direct + IndexedDB |
| Loading | whole bank up front (`build`, ~5 min) | index up front (~1.7s), bodies on demand |
| Grading | server | browser |
| Answer key | withheld until you answer | necessarily in the browser |
| Progress | `data/bluebank.db` | IndexedDB |

Selected at BUILD time, not by probing:

```
npm run build         # -> dist/        localhost   (VITE_BACKEND unset)
npm run build:pages   # -> dist-pages/  Pages       (.env.pages sets local)
```

`?backend=local` or `?backend=http` overrides for one page load, so the static
path can be exercised against the dev server without a separate build.

**Progress is deliberately NOT shared.** The user chose this. Answering on
Pages does not appear on localhost.

### Why the index/bodies split matters

The five-minute load was never a per-visit cost (IndexedDB survives tab close),
but it did not need to exist at all. Measured against the live API:

| Tier | Requests | Time |
|---|---|---|
| Index (all 3,770 entries: id, section, domain, skill, difficulty, band) | **2** | **1.66s** |
| One question body | 1 | ~80ms |

The index is everything Home, the filters, and the navigator need. Bodies are
fetched on navigation and prefetched 4 ahead. You never download the ~3,000
questions you do not look at.

### Verified end to end, in a real browser

Not inferred. The built `dist-pages` was served at its real base path and
driven over the DevTools Protocol:

- CORS: all three College Board endpoints return 200 from a foreign origin.
  Three previous handoffs flagged this as curl-only; it is now first-hand.
- The static build loaded 3,767 questions with no server and no console errors,
  and its section and domain counts match the localhost backend exactly.
- A question was fetched, normalised, rendered (MathJax and inline SVG), and
  graded in-browser; the score went 0/0 to 1/1.
- Both backends return **byte-identical question ordering** (same first 12 ids),
  so "question 40" means the same question in both.

### The ordering hash changed: blake2b -> FNV-1a + splitmix64

`shuffle_key` is now FNV-1a with a **splitmix64 finalizer**, in both
`satbluebank/db.py` and `web/src/lib/shuffle.ts`, with pinned values shared
between `tests/test_backend.py` and `web/src/lib/shuffle.test.ts`.

blake2b was dropped because it has no browser equivalent and WebCrypto's
SHA-256 is async, which a sort comparator cannot use. FNV is five lines in
either language.

**The finalizer is not decoration.** Raw FNV-1a barely avalanches into the high
bits, and the high bits are what a sort reads: every id starting `m` hashed to
`0x08a98...` and every id starting `r` to `0x08dc8...`, so the "shuffle" was
really "sort by first character" and put the sections straight back into
blocks. The real bank happened to interleave anyway, which is exactly how this
would have shipped unnoticed. The synthetic interleaving test caught it. Keep
that test.

### The TypeScript port, and how it was verified

| Module | Ported to | Verification |
|---|---|---|
| `grading.py` | `lib/grading.ts` + `lib/fraction.ts` | 2,282 canonical/fraction cases and 2,400 grade pairs diffed against Python: **0 mismatches** |
| `rationale.py` | `lib/rationale.ts` | Run against **all 3,767 live rationales**: identical splits, identical flags, identical classification of ~13,000 explanations, identical recovered keys |
| `pipeline.py` normalise | `lib/normalize.ts` | Section/domain counts on Pages match localhost exactly |
| `session.py` | `apiLocal.ts` | Same |
| `db.shuffle_key` | `lib/shuffle.ts` | Pinned values shared with the Python test; both backends order identically |

`fraction.ts` is a BigInt rational, not floats. `3/17` must compare unequal to
`0.1765` and `1.5` must compare equal to `3/2`; doubles get both wrong.

**Re-running the differential** (do this after touching either parser): dump
Python's output for the corpus to JSON, then compare from a vitest file. The
one-off harness is not committed because the fixture is 22 MB of College Board
text. It took about ten minutes to write; see the git history of this section
if you need the shape.

### Two bugs the differential caught that review would not have

1. **Entity decoding via the DOM.** `unescapeHtml` first resolved named
   entities through a detached `<textarea>`. That works in a browser and
   silently returns the raw `&rsquo;` anywhere else, so `flatten()` was wrong on
   **2,492 of 3,767** questions. It is now an explicit 62-entry table generated
   from the corpus with Python's own `html.unescape`. Note `nbsp` is U+00A0, not
   a space. Unknown entities are left literal and collected in
   `unknownEntities` rather than corrupting quietly.
2. **The FNV high-bit clustering** described above.

---

## 8. UI state

Four passes done. Reference screenshots are in `reference/` (gitignored).

Passes 1 and 2 are history: pass 1 built Bluebook's question anatomy, pass 2
went generic-modern (dropped the practice banner, the dashed rules, the colored
bands, replaced glyphs with a hand-rolled icon set). Pass 2 went too far from
the real thing.

**Passes 3 and 4 (2026-08-19) went back to Bluebook**, measured against a real
screenshot rather than eyeballed. Pass 4 was verified in a rendered browser;
pass 3 was not.

### Measure, don't eyeball

Every number below came out of the reference PNG with PIL, taking the modal
color of a region so antialiasing did not skew it. Do the same for any new
screenshot instead of guessing hex values.

| Thing | Measured | Token |
|---|---|---|
| Header / footer band | `#e6edf8` | `--chrome` |
| Buttons, selection, ABC key | `#324dc8` | `--accent` |
| Ring around a selected choice | `#85bcf9` | `--accent-ring` |
| Question band | `#f0f0f0`, 34px tall | `--band` |
| Number badge, question pill | `#1e1e1e` | `--ink` |
| Unselected choice border | `#aeaeae` 1px | `--line-2` |
| Pane divider | `#888888`, **4px** solid, full height | — |
| Divider grab handle | 14x29 black, arrows out both ways | `SplitHandle` |
| Handle glyph | 12x11, two outward arrows, 2px gap | `SplitHandle` |
| Choice box | **52px** tall, 10px radius | — |
| Practice banner (unused) | `#1b2264` | `--navy` |

The old accent was `#2563eb`, a stock Tailwind blue. That is what "the blue
looks lifeless" was about.

### The dashed rules are gradients, not borders

Bluebook's rules are **26px dashes with 2px gaps, 2px tall, near-black**.
`border: 2px dashed` ties dash length to border width and gives ~4px dashes,
which is why the first attempt looked wrong. They are drawn with `--rule`, a
`repeating-linear-gradient` used as a 2px-tall `background-image`:

```css
--rule: repeating-linear-gradient(to right, var(--ink) 0 26px, transparent 26px 28px);
```

Verified in the render: dash runs come back as 26px on / 2px off at `#1e1e1e`,
matching the reference exactly. Applied to `.topbar` (bottom), `.bottombar`
(top), and `.q-head` (bottom).

### The divider handle: arrows point OUT, and there is no centre bar

Two wrong attempts here, both worth remembering. The handle is a 14x29 black
rounded rect and it **is** centred (measured: handle midpoint x=801.5 against a
divider at 800-803, y=506 against a 86-925 span). What looked off-centre was
the glyph inside it:

1. First attempt drew the triangles with their apex **inward**, so they widened
   toward the outside. The real ones have the flat edge against the middle and
   the point at the outer edge.
2. First attempt also drew a white centre bar. There is no bar - the dark gap
   between the two arrows *is* the handle showing through. Adding a bar puts a
   white stripe down the middle that the real one does not have.

Final geometry, matched row-for-row against the reference: viewBox `0 0 12 11`,
`M5 0L0 5.5 5 11z` and `M7 0L12 5.5 7 11z`, a 2-unit gap. Compare with the
ASCII-diff trick (print `#`/`+`/`.` per pixel for both images side by side)
rather than by eye; that is what caught both mistakes.

### The grey band does NOT bleed to the pane edge

Measured on the real app: the band runs 846 to 1547 while the right pane runs
804 to 1591. It spans the **content column** - its left edge lines up with the
choice boxes and the number badge sits flush against it, its right edge clears
the cross-out gutter. Pass 3 had it full-bleed, which was wrong.

Because of that, `.pane` no longer needs to give up its padding, but the
current split (padding on `.prompt` and a direct-child `.passage`, not on
`.pane`) is still what is in the file and is harmless.

### Layout, as it now stands

- **Header**: pale blue band, dashed rule under it. Left is the set title in
  19px bold with a back chevron, `Directions` under it. The title **tracks the
  filters** (`Reading and Writing: Standard English Conventions`), the way the
  real one reads `Section 1, Module 2: Reading and Writing`. Center is a 26px
  clock over the outlined `Hide` pill. Right is icon-over-label tools.
- **Question band**: black number badge flush left, bookmark + Mark for Review,
  blue `ABC` key far right. The skill name chip that used to sit next to the
  `ABC` key is gone - it read as noise.
- **Choices**: 52px boxes, 1px `#aeaeae`. Selected draws a 2px blue edge inside
  a pale blue ring. The cross-out toggle outside the box is a lettered circle
  with a rule struck across it; **crossing out turns the circle blue** and
  keeps the letter. It used to swap in an "Undo" label, which was bad.
- **Footer**: mirrors the header. Left is the fixed wordmark **SAT Bluebank**.
  Black `Question N of M` pill centered, two blue pills right.
- **Fonts**: Noto Sans for chrome, Noto Serif for question content, with
  italics because passages use them.
- **Mark for Review** is a bookmark, not a flag, and blue not red.

### The app is called SAT Bluebank. Never write "Bluebook" in the UI.

Pass 4 briefly put "SAT Bluebook" in the footer and then, worse, invented a
"SAT BLUEBOOK" wordmark on the home page that nobody asked for. Both are gone.
**Bluebook** is College Board's own app and the word belongs only in code
comments describing what is being copied, never in anything the user sees.

The home header is now literally `SAT Bluebank` over
`{total} official College Board questions with explanations` - no tagline, no
invented marketing line, no decorative eyebrow label. The user's words were
"looks SUPER ai i HATE THAT". Do not add one back.

### Home page (rebuilt in pass 4)

The native `<select>` dropdowns are **gone**. There are only 8 domains and at
most 7 skills in any one of them, so a dropdown was the wrong control for the
data: they are chip rows now, with the count on each chip. Difficulty and
history are segmented pills.

`.segmented` is `flex-wrap: nowrap` and `.field-row .field` is `flex: 0 0 auto`
on purpose. With wrapping allowed, the 5-option history control broke out of
its pill shape into a rounded blob. Each control sizes to its own content.

### Gotcha that cost 33px per choice box

`RichText` renders College Board's `<p>` tags. `.passage p, .stem p` had their
margins zeroed but **`.choice-text p` did not**, so the browser default of
`1em` top and bottom made every choice box 85px instead of 52px. There is now
an explicit `.choice-text p { margin: 0 }`. Watch for this on any new
rich-text surface.

### Verified in pass 4

Rendered and checked against the reference: header, footer, dashed rules, band
geometry, choice box height, divider, and the selected / crossed-out / marked
states. Backend 29 tests and frontend 12 tests pass, `tsc --noEmit` clean.

**Navigator colors**, specified by the user:

| State | Color |
|---|---|
| Unanswered | White, dashed border |
| Right first try | Green **(assumed - user never specified this one)** |
| Right after 2+ tries | Yellow |
| Latest attempt wrong | Red |

**Cross-out toggle** is on by default, per user request.

### Pass 5 fixes (2026-08-19), all verified in a browser

- **`sr-only` was rendering.** The bank ships a long-form description of every
  chart for screen readers, marked `class="sr-only"`, and it is in **1,375 of
  3,767 questions**. With no rule for the class, the whole data table
  ("Begins at 1900, 25.9. Falls gradually to 1910, 25.1 ...") was dumped onto
  the page under the graph. Now clipped, **not** `display: none`: the text must
  stay in the accessibility tree, and it must stay in the text-node stream or
  every saved highlight offset after it would shift.
- **`.hl-note` was two different things.** The popup's note input and the
  `<mark>` for a highlight-with-a-note shared one class, so every noted
  highlight picked up the input's pill border, radius and padding. The input is
  `.hl-note-input` now. Do not merge them again.
- **"Full explanation" was already `--accent`.** Measured: `rgb(50,77,200)`,
  the same blue as the Next button. It read purple because a bare `<summary>`
  in thin 14px text looks like a default HTML disclosure link. Restyled as a
  pill control with a custom chevron.
- **The expanded calculator is draggable.** Split mode reports its percentage up
  to the shell, which reflows the question pane via `--tool-split`, so dragging
  the edge resizes both halves together like the passage divider. Verified: the
  panel went 792px to 540px and the pane margin followed exactly.
- **"Review" in the header was redundant** with the question pill in the footer.
  Replaced with **Highlights & Notes**, as Bluebook has: a side panel listing
  every mark on the question with its quote, its note, and a delete button.
  The quoted text is read back out of the DOM via `data-ann-id` rather than
  stored, so there is no schema change and nothing to keep in sync.

The note flow was driven end to end over CDP: select text, popup appears,
survives clicking into the input, note saves, the mark gets `hl-note` and a
title, and the panel shows the quote and the note.

### Still not matched, deliberately

- **The "THIS IS A PRACTICE TEST" banner** is in the reference but stays out;
  it was removed at the user's explicit request in pass 2. `--navy` is sampled
  and declared if it comes back.
- **Highlights & Notes** is a real Bluebook header button opening a panel. This
  app has highlighting but no panel, so that slot holds a `Review` button that
  opens the question navigator.

### Open UI decisions

1. **Green for first-try-correct** was assumed, never confirmed.
2. Whether the practice-test banner comes back.
3. The navigator popup has **not** been re-checked against the new palette in a
   render. The explanation view has - the user confirmed it looks right.

## 9. Gotchas

### How to actually look at the UI (do this before any UI work)

The Chrome extension has been disconnected for three sessions running, and
there is no Playwright or Puppeteer in `web/node_modules`. Two passes shipped
blind because of that. **You do not need either** - the installed Chrome takes
a screenshot from the command line:

```bash
"/c/Program Files/Google/Chrome/Application/chrome.exe"   --headless=new --disable-gpu --hide-scrollbars   --window-size=1600,1000 --screenshot="$SP/shot.png"   --user-data-dir="$SP/chromeprofile" --virtual-time-budget=6000   "http://localhost:8000/"
```

`--virtual-time-budget` is what waits for React and the API round trip; without
it you screenshot a blank root. `--user-data-dir` has to point somewhere
writable or Chrome refuses to start.

**Anything that fetches needs real time, not virtual time.**
`--virtual-time-budget` fast-forwards timers, which fires the 60s
`AbortSignal.timeout` in `cbApi.ts` before a real 0.5s request can land, so the
page looks like it hung. Symptom: the app renders but shows 0 questions and
"Counting...". Drive it over the DevTools Protocol instead:

```bash
chrome.exe --headless=new --remote-debugging-port=9222 --user-data-dir=... about:blank &
node cdp.mjs "http://localhost:8124/SAT-Bluebank/" 20000 shot.png
```

Node 24 has a global `WebSocket`, so a CDP driver is about 40 lines and needs
no dependency. It can click, evaluate, read IndexedDB, capture the screenshot,
and report console errors and failed requests. That is how the Pages build was
verified. A related trap: a **fresh** `--user-data-dir` burns the virtual-time
budget on first-run setup, so reuse a warm profile.

Headless Chrome cannot click, so to see any state past the home page,
**temporarily** patch the initial state in `App.tsx`, build, shoot, then revert:

- `view` to `'practice'` and `filters` to `{ section: 'RW', domain: 'SEC' }`
  for a split-pane reading question
- for selection / cross-out / marked, patch the **reset lines inside the
  `current?.id` effect**, not the `useState` initialisers - the effect runs on
  load and overwrites the initialisers, which is why the first attempt showed
  nothing

Then measure the result against `reference/` with PIL rather than trusting your
eye; that is how the 85px choice box and the too-short dashes were caught.


- **`data/`, `raw/`, and `reference/` are gitignored.** No College Board
  content and no screenshots should ever be committed.
- **The screenshot is out of local git history** (2026-08-19). `filter-branch`
  stripped it from both commits, the `refs/original` backups and the reflog
  were expired, and `git gc --prune=now` destroyed the blob. Verified: the old
  SHAs `18782fd` and `e8c4235` no longer resolve and no reachable object
  carries the filename. New history is `81b6384` -> `00380a7`.

  **The remote still has it.** `git push --force origin main` was blocked by
  the sandbox, so the user must run it. And note the important caveat: a force
  push does **not** guarantee GitHub drops the old objects. They stay reachable
  by direct SHA URL until GitHub's own GC runs, which is not user-triggerable.
  For a guaranteed purge before going public, delete the repository on GitHub
  and push fresh; with two commits that costs nothing.

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
  db.py          SQLite schema + shuffle_key(), the stable set ordering
  pipeline.py    pass 1 index, pass 2 fetch (resumable), pass 3 normalize
  rationale.py   per-choice explanation splitting + answer-key recovery
  grading.py     answer canonicalization + membership/rational matching
  session.py     practice logic, question sets, taxonomy, stats
                 (question_set defaults to order="shuffled", see 7b)
  server.py      stdlib HTTP API + serves web/dist
  cli.py         index/fetch/normalize/build/serve/stats/show/answer/audit/import
tests/           32 backend tests
                 (grading + rationale are ALSO ported to web/src/lib/*.test.ts)
web/src/
  App.tsx        shell, home/practice routing, keyboard
  api.ts         ~50-line API client; the whole data layer sits behind this
  types.ts
  components/    Home, QuestionView, Navigator, Explanation, RichText, Icon, Desmos
  api.ts         backend picker (build-time, VITE_BACKEND)
  apiHttp.ts     localhost backend: the Python server
  apiLocal.ts    static backend: College Board direct + IndexedDB
  lib/fraction.ts  BigInt rationals; floats cannot grade 3/17
  lib/grading.ts   port of grading.py
  lib/rationale.ts port of rationale.py (the risky one)
  lib/normalize.ts port of the pipeline normalise pass
  lib/shuffle.ts   set ordering; twin of db.shuffle_key
  lib/cbApi.ts     the three College Board endpoints, from the browser
  lib/store.ts     IndexedDB: index, questions, attempts, marks, annotations
  lib/ranges.ts  highlight anchoring (+ ranges.test.ts, 12 tests)
  lib/useTimer.ts per-question timer, pauses when tab hidden
  styles.css     all styling; --sans at the top swaps the typeface
reference/       Bluebook + OnePrep screenshots, gitignored
```

---

## 11. Suggested next actions

1. **Force-push the rewritten history**, then decide whether to delete and
   recreate the GitHub repo for a guaranteed purge, before making it public.
2. Render the navigator popup and check it against the new palette. It has not
   been looked at since pass 2.
3. Confirm the first-try-correct color.
4. Add a UUID to the SQLite `attempts` table too. The IndexedDB side already
   uses one; the Python side is still an autoincrementing integer.
5. Consider a "download the whole bank" button on the static build for offline
   use, now that on-demand is the default.
