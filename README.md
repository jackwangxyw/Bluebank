# Bluebank

This is a simple and modern UI for the official College Board SAT question bank. The tool does not store any actual question data, it pulls the questions from College Board themselves and just displays it. There are official explanations for each problem and stats to help you figure out what section you need to study more on.

![Practice view](Images/practice.png)

## The App
The UI is built based off of Bluebook, the app you actually take the test in, so the interface isn't new to you on test day. Reading and writing questions put the passage on one side and the question on the other, with a divider you can drag. Math questions put the figure above the question.

You get highlighting and notes, answer cross out, and a navigator showing which questions you've done, which you got wrong, and which you marked to come back to. Math questions come with the Desmos calculator, in the same restricted version College Board gives you, so you're practicing with the tools you'll actually have on the day.

Every question is marked the moment you answer it. Multiple choice questions come with College Board's own explanation of why each choice is right or wrong, not just which one was correct, which is usually the more useful half.

The stats page breaks down what you've covered and where you're getting things wrong, by section, domain and skill, so you can aim your practice instead of guessing.

Mobile has its own layout that keeps the aesthetic but is easy to use on a smaller device. Questions are laid out vertically instead of being split down the middle.

Once a question has loaded, everything except the calculator keeps working with no connection.

The app does have a google login for syncing your data across devices, but this is strictly NOT needed for normal use. There's more information on our privacy and data collection on the about page of the site itself.

## Quick Start for Self Hosting
Everything from here down is for running your own copy. If you just want to use the site, you're done.

You need Python 3.9 or newer and Node. The build takes about five minutes, almost all of it downloading question bodies at 12.8 requests a second.

```
python -m bluebank build     # index, fetch, normalize
cd web && npm install && npm run build
cd .. && python -m bluebank serve
```

Then open http://localhost:8000. If you only want to poke at the data, `build` on its own is enough and you can skip the web part entirely.

For frontend work, run `python -m bluebank serve` in one terminal and `npm run dev` in another. Vite sits on 5173 and proxies `/api` to 8000, so you get hot reload against the real data.

## Two Backends
The frontend talks to one module, [web/src/api.ts](web/src/api.ts), and nothing else in the app touches the network or storage. That module picks between two implementations at build time.

| | localhost | static build |
| :--- | :--- | :--- |
| Data | Python server and SQLite | College Board direct, cached in IndexedDB |
| Loading | whole bank up front, about 5 minutes | index in 1.7 seconds, bodies on demand |
| Grading | server | browser |
| Answer key | withheld until you answer | necessarily in the browser |
| Progress | `data/bluebank.db` | IndexedDB, optionally synced |

```
npm run build         # -> dist/        localhost
npm run build:pages   # -> dist-pages/  static, no server
```

`?backend=local` or `?backend=http` overrides it for one page load, which is handy for testing the static path against the dev server without a separate build.

The two don't share progress. Answering on one doesn't show up on the other, and only the static build can sync.

The static build depends on College Board sending `Access-Control-Allow-Origin: *`, which they currently do on all three endpoints. That header is theirs to change and if they tighten it the static build stops working in a browser while the Python one keeps going, since a server ignores CORS. That's most of the reason both still exist.

## Running Your Own Sync Server
Skip this unless you want sync on your own deployment. Leave `VITE_SYNC_API` and `VITE_GOOGLE_CLIENT_ID` blank in [web/.env.pages](web/.env.pages) and the account UI doesn't render at all, which is also the rollback.

The server is one Cloudflare Worker over a D1 database, in [worker/](worker). Create a D1 database, paste [worker/schema.sql](worker/schema.sql) into its console, paste [worker/src/index.js](worker/src/index.js) into a worker, bind the database as `DB`, and set `GOOGLE_CLIENT_ID` to an OAuth client id. Then put the worker URL and that same client id into `.env.pages`.

`GET /health` on the worker reports which bindings actually landed. Check it first if sign-in fails, because setting a binding in the dashboard without deploying leaves it missing at runtime and nothing else tells you.

Attempts merge by union on a uuid, which means a sync that fails, runs twice, or arrives out of order can't lose or duplicate anything. Marks and annotations are last write wins per question, decided on the server so a device with a wrong clock can't stomp newer data.

## Commands
| Command | What it does |
| :--- | :--- |
| `index` | Pass 1, builds `data/index.json` from two API calls |
| `fetch` | Pass 2, downloads question bodies into `raw/`, resumable |
| `normalize` | Pass 3, parses everything into SQLite |
| `build` | All three |
| `serve` | API plus the built frontend on :8000 |
| `stats` | Counts by section, domain and type |
| `show <id>` | Prints one question |
| `answer <id> <response>` | Grades from the command line |
| `audit` | Lists flagged questions, should be exactly 3 |
| `import <file.json>` | Loads questions from a file instead of the API |

`fetch` skips anything already in `raw/` with a matching `updateDate`, so re-running it after an interruption picks up where it stopped.

## Where the Data Lives
Three tables in [data/bluebank.db](data) are yours: `attempts`, `annotations` and `marks`. Everything else re-downloads. That's about 2 KB of real data sitting inside a 47 MB file, so back up the tables rather than the database.

```
python -c "
import sqlite3, json, io
c = sqlite3.connect('data/bluebank.db'); c.row_factory = sqlite3.Row
out = {t: [dict(r) for r in c.execute('select * from %s' % t)] for t in ('attempts','annotations','marks')}
io.open('progress-backup.json','w',encoding='utf-8').write(json.dumps(out, indent=1))"
```

To wipe your progress and keep the questions, delete from those same three tables. To wipe everything, `rm -rf data raw` and run `build` again.

On the static build it's IndexedDB under database `bluebank`, and `indexedDB.deleteDatabase('bluebank')` in the console clears it. The app calls `navigator.storage.persist()` on startup so the browser won't evict the cache under storage pressure. If you've signed in, clearing that only clears this device; the delete button in the sync panel is what removes the copy on the server.

The cached index is re-read after a week. Without that it was fetched once on your first visit and never again, so new questions added to the bank would never show up on that device.

## The API
Three endpoints, no authentication of any kind. Confirmed with bare curl sending only `Content-Type`, and confirmed again from a real browser on a foreign origin.

```
POST https://qbank-api.collegeboard.org/msreportingquestionbank-prod/questionbank/digital/get-questions
     {"asmtEventId": 99, "test": 1, "domain": "INI,CAS,EOI,SEC"}   # 1 = RW, 2 = Math
POST .../questionbank/digital/get-question   {"external_id": "..."}
GET  https://saic.collegeboard.org/disclosed/{ibn}.json
```

Math domains are `H,P,Q,S`. Difficulty is E/M/H, but there's also `score_band_range_cd`, which runs 1 to 7 and is finer, so use that one if you ever build adaptive logic on top of this.

The whole index is those first two calls and takes 1.7 seconds. The individual bodies are what take five minutes.

## Vendored Assets
MathJax is vendored at [web/public/mathjax/mml-svg.js](web/public/mathjax) and outputs SVG, so there are no font files to fetch and it works offline. Noto is self hosted in [web/src/fonts](web/src/fonts) rather than loaded from Google, since a font CDN sees the IP of every visitor whether or not they ever sign in.

Desmos is the exception and loads from their CDN the first time you open the calculator. It runs in their restricted testing mode, the `restrictedFunctions` option, which is what College Board uses. Nothing else in the app needs the network once it's built.

## Explanations
Each rationale arrives as one HTML blob covering all four choices, and [bluebank/rationale.py](bluebank/rationale.py) splits it into a piece per choice. It cuts the HTML rather than flattened text, so MathML and inline SVG survive, and each piece gets rebalanced because the cuts land in the middle of a paragraph.

The wording varies more than you'd expect. `&nbsp;` shows up inside "Choice A&nbsp;is", the letter is sometimes wrapped in a tag, rejections come grouped as "Choices A, B, and C are incorrect", the verb goes missing in "Choice B incorrect.", and the `ibn` items use "<p>Incorrect Answer Rationale<br>" headers with no terminating period.

Two shapes have to not match. "choice D is the only graph that passes through the point" is a mid sentence reference, and "Choices B and D show models of the form" is a plural reference rather than a rejection. Splitting on either of those truncates somebody's explanation.

## Correctness Guards
Two bugs in here silently produced wrong answer keys before they were caught, which is worse than a missing key because it tells you the wrong thing and you never find out.

| Bug | Effect |
| :--- | :--- |
| `.strip(".")` on a recovered answer | Turned `.1667` into `1667`, and it was live in the database |
| `([^.]+?)` in the SPR pattern | Can't cross a decimal point, so "The correct answer is 0.25." captured `0` |
| `re.findall("[A-D]", "A, B, and C", IGNORECASE)` | Also matches the a and d in "and" |
| `{_SP}?` where `_SP` is `(?:...)+` | Compiles to a lazy one-or-more instead of an optional group |

`normalize` also cross checks the split against the key. Exactly one per choice explanation has to read as "correct" and it has to be the keyed choice. That agrees on all but two multiple choice questions. Those two are real defects in College Board's own text where the options were reordered and the prose wasn't updated, so their per choice mapping gets dropped and you see the whole rationale instead. Left alone they'd tell a student who picked D that they were right.

`python -m bluebank audit` should report exactly 3 flagged questions. If it reports more, something in the parser broke.

## Grading
`correct_answer` is a list, and it mixes two different things: alternate spellings of one value like `["0.25", "1/4"]`, and genuinely different valid answers like `["7", "8", "13"]` for "one possible value of a". Grading is a membership test either way, so the review screen shows every accepted form rather than the first one.

A response is also accepted if it's numerically equal to a listed answer, so typing 1.5 for a listed 3/2 is right. That comparison uses exact rational arithmetic, `Fraction` in Python and a BigInt fraction in TypeScript. Floats get 3/17 wrong.

## Ordering
Sets are ordered by `shuffle_key`, which is FNV-1a over the question id with a splitmix64 finalizer, in [bluebank/db.py](bluebank/db.py) and mirrored in [web/src/lib/shuffle.ts](web/src/lib/shuffle.ts). The two return identical values and the tests pin them.

Without it, section sorts before domain and you get every Math question before the first Reading one. With it, question 40 is the same question tomorrow, after a rebuild, and on the other backend, because the key comes from the id rather than from stored state.

The finalizer isn't optional. Raw FNV-1a barely reaches the high bits, which are the ones a sort reads, so every id starting with the same letter landed together and the "shuffle" was really sorting by first character.

## Tests
```
python -m pytest tests -q     # 38
cd web && npm test            # 61
```

The rationale parser and the grader exist in both Python and TypeScript, and the TypeScript ports were checked against the Python by running both over the whole corpus: every rationale split identically, every explanation classified identically, every recovered key identical. The committed tests are the standing guard, that run was the one off proof. The HTML in the committed cases is paraphrased rather than copied, so no question content is in the repo.
