# SAT Bluebank

A local Bluebook-style SAT practice tool backed by the official College Board
question bank, with auto-grading and College Board's own explanations, including
the per-choice explanation of why the answer you picked is wrong.

**This repo contains code only.** No College Board content is committed. On first
run the exporter fetches the bank itself into a local, gitignored SQLite database,
so there is nothing to redistribute and you always get current content.

Python 3.9+, no dependencies.

## Quick start

```
python -m satbluebank build      # index + fetch + normalize, about 5 minutes
cd web && npm install && npm run build && cd ..
python -m satbluebank serve      # http://localhost:8000
```

Working on the frontend, with hot reload:

```
python -m satbluebank serve      # terminal 1, API on :8000
cd web && npm run dev            # terminal 2, UI on :5173, proxies /api
```

The CLI still works on its own if you want it:

```
python -m satbluebank stats
python -m satbluebank show --section MATH --difficulty H
python -m satbluebank answer <question-id> C
```

`serve` binds to `127.0.0.1`. `--host 0.0.0.0` opens it to your network, which
is the only change needed to put it behind a domain later.

`build` is resumable. Rerunning it refetches only questions whose `updateDate`
moved, so a routine refresh touches tens of items rather than thousands.

## Commands

| Command | What it does |
|---|---|
| `index` | Pass 1. Two list calls, writes `data/index.json` |
| `fetch` | Pass 2. Question detail into `raw/{path}/{id}.json`, skipping current files |
| `normalize` | Pass 3. Pure offline pass, both API shapes into one SQLite schema |
| `build` | All three in order |
| `stats` | Corpus counts by section/domain/type, plus your attempt history |
| `show` | Print one question, filtered or by `--id` |
| `answer <id> <response>` | Grade a response and print the official explanations |
| `audit` | List every question the normalizer flagged. Should be 3 |
| `import <file.json>` | Load questions from a JSON array against the normalized schema |
| `serve` | Run the practice app and its JSON API |

`normalize` and `audit` accept `--strict` to exit nonzero when anything is
flagged, for use in a scheduled refresh.

## Data source

Three unauthenticated endpoints. No cookie, key, or token.

| Endpoint | Purpose |
|---|---|
| `POST qbank-api.collegeboard.org/.../get-questions` | Index of stubs, no content |
| `POST qbank-api.collegeboard.org/.../get-question` | Detail by `external_id` |
| `GET saic.collegeboard.org/disclosed/{ibn}.json` | Detail by `ibn` (legacy) |

Every question is on exactly one path, and the unused field is an empty string
rather than null, so `pipeline` tests truthiness. The `ibn` path is frozen: all
459 of its items are from the original 2023-08-02 batch, and every update batch
since has been `external_id` only. A few `external_id`s appear twice in the
index under different `questionId`s, so pass 1 collapses them to the newest;
3,770 index entries are 3,767 distinct questions.

On the `ibn` payload the stem is in `prompt` and the stimulus is in a separate
`body` field, present on 218 items and easy to miss. Without it, a question like
"Which of the following is equivalent to the expression above?" arrives with no
expression.

The export is fully self-contained. Images are `data:` URIs, figures are inline
SVG on the modern path, and math is MathML with a plain-English `alttext`. There
are no external asset references, so the bank works offline once fetched.
Render with MathJax; it handles MathML natively.

## Explanations

College Board ships one rationale blob per question. For multiple choice it
covers every option in turn ("Choice B is the best answer because...", "Choice A
is incorrect because..."), so `rationale.split_explanations` cuts it into a
`{letter: html}` map. That is what makes "here is why the answer you picked is
wrong" possible from official text alone, with nothing generated.

Splitting is done on the HTML, not on flattened text, so MathML and SVG survive
intact, and each segment is re-balanced because cuts land mid-paragraph.

The parser handles the real variations in the source: `&nbsp;` inside "Choice
A&nbsp;is", the letter wrapped in a tag (`Choice <span>C</span> is`), grouped
rejections ("Choices A, B, and C are incorrect"), the singular-with-a-list typo
("Choice B, C, and D are incorrect"), adverbs ("are also incorrect"), and the
missing verb ("Choice B incorrect."). It ignores mid-sentence references that
look like boundaries but are not, such as "...choice D is the only graph that
passes through the point..." and "Choices B and D show models of the form...".

## Correctness guards

A wrong answer key is worse than a missing one, so recovery never falls back to
a guess. Three invariants run on every normalize:

1. **Explanation against key.** Exactly one per-choice explanation must read as
   correct, and it must be the keyed choice. Two questions in the bank have
   stale letters in their rationale prose after their options were reordered;
   for those the mapping is dropped and the full rationale is shown instead,
   rather than telling you a wrong pick was right.
2. **Recovered MCQ keys.** Exactly one distinct letter may match
   `Choice X is the best/correct`. More than one means the wording changed.
3. **Recovered SPR keys.** The value must be numeric-looking after commas and
   spaces come off. The `alt` text is a screen-reader rendering, so a rationale
   can say "three halves" where the enterable answer is `3/2` or `1.5`; the
   "ways to enter" sentence is tried first for exactly that reason.

Anything that fails is flagged and counted, never silently stored. `audit`
prints the flagged set; a healthy corpus reports 3, all genuine defects in
College Board's own text.

## Grading

`correct_answer` is an array of accepted strings, and it conflates two different
things: alternate spellings of one value (`["0.25", "1/4"]`) and genuinely
different valid answers (`["7", "8", "13"]` for "a possible value of a"). Both
grade as a membership test, but the review UI must show every accepted form, not
`accepted[0]`, or it will tell you "the correct answer is 10/3" on a question
where 3.75 was equally right.

Responses are canonicalized before comparison (whitespace, thousands commas,
unicode minus, leading zero, trailing decimal zeros), then checked for exact
membership, then for exact rational equality. The result records which of the
two matched.

## Schema

`questions` holds the normalized bank; `attempts` holds your history from the
first commit, because wrong-answer review is the reason to build this rather
than use the real site. `key_recovered` marks the 81 questions whose answer was
recovered from the rationale, and `flags_json` carries any normalize warnings.
See `satbluebank/db.py`.

`session.py` is the practice API the UI will sit on: `pick`, `get_question`,
`submit`, `stats`, `wrong_answers`.

## Refresh

The index is the source of truth, not an append-only feed. Each sync reconciles
against the full index, so a question that disappears is marked `retired` rather
than left live, and an item migrating between paths cannot leave a duplicate.
Key recovery is an algorithm in the normalize pass, not a stored fixup, so it
re-runs every sync and cannot go stale. Rerun `normalize` over everything after
any refresh; it is a local pass and costs seconds.

## The app

React and TypeScript, built with Vite into `web/dist`, which `serve` hosts. No
separate frontend server in normal use.

| Piece | Where |
|---|---|
| Bluebook shell, split pane, navigator, timer | `web/src/App.tsx`, `components/` |
| Highlight and note anchoring | `web/src/lib/ranges.ts` |
| Per-question timer | `web/src/lib/useTimer.ts` |
| API client | `web/src/api.ts` |

**Highlights** are anchored by character offset into a field's text, measured
over text nodes only, skipping math, figures, and images. That is what lets
MathJax replace every `<math>` element with generated SVG without moving a
single highlight. The question HTML is fixed once it is in the database, so the
offsets stay valid across reloads.

**Math** is rendered by MathJax, vendored into `web/public/mathjax` as the
MathML-to-SVG build. SVG output means no font files to fetch, so it works
offline.

**The timer** starts when a question is shown and stops when you answer, and
does not accrue while the tab is hidden, so a question left open overnight does
not record as an eight-hour attempt.

**Desmos** loads from their CDN the first time you open the calculator, and not
before, so the rest of the app needs no network. It uses the demo API key from
Desmos's own docs; get your own if you ever host this publicly.

**The answer key never reaches the browser before you answer.** `GET
/api/questions/{id}` omits the key, the per-choice explanations, and the
rationale. They come back only in the response to `POST .../answer`.

## Tests

```
python -m unittest discover -s tests    # 29 backend tests
cd web && npm test                      # 12 highlight-anchoring tests
```

Every case is a shape that actually occurs in the bank, with the question id it
came from in a comment.
