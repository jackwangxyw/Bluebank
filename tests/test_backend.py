"""Regression tests. Every case here is a real shape found in the bank, not a
made-up example; the comment names the question it came from.
"""
import os
import shutil
import sqlite3
import tempfile
import unittest
import uuid

from bluebank import db, grading, rationale, session


class TestCanonical(unittest.TestCase):
    def test_leading_and_trailing_zeros(self):
        self.assertEqual(grading.canonical("0.25"), ".25")
        self.assertEqual(grading.canonical("1.50"), "1.5")
        self.assertEqual(grading.canonical("  3 / 17 "), "3/17")
        self.assertEqual(grading.canonical("1,200"), "1200")
        self.assertEqual(grading.canonical("−4"), "-4")   # unicode minus
        self.assertEqual(grading.canonical("0.0"), "0")

    def test_fraction_parsing(self):
        self.assertEqual(grading.as_fraction("3/2"), grading.as_fraction("1.5"))
        self.assertIsNone(grading.as_fraction("three halves"))
        self.assertIsNone(grading.as_fraction("1/0"))


class TestGrading(unittest.TestCase):
    def test_alternate_spellings_are_accepted(self):
        # 65ac5dc5: both truncated and rounded decimals plus the fraction
        accepted = [".1764", ".1765", "3/17"]
        for response in ("0.1764", ".1764", "3/17", "0.1765"):
            self.assertEqual(grading.grade_spr(response, accepted), (True, "listed"), response)
        self.assertEqual(grading.grade_spr("0.18", accepted), (False, None))

    def test_numerically_equal_but_unlisted(self):
        self.assertEqual(grading.grade_spr("1.5", ["3/2"]), (True, "equivalent"))

    def test_blank_response_is_wrong_not_an_error(self):
        self.assertEqual(grading.grade_spr("", ["4"]), (False, None))
        self.assertEqual(grading.grade_spr(None, ["4"]), (False, None))
        self.assertEqual(grading.grade_mcq(None, ["A"]), (False, None))

    def test_several_genuinely_different_answers(self):
        # 070631-DC: "what is one possible value of x"
        accepted = ["10/3", "15/4", "25/6", "3.333", "3.75", "4.166", "4.167"]
        for response in ("10/3", "3.75", "4.167"):
            self.assertTrue(grading.grade_spr(response, accepted)[0], response)
        self.assertFalse(grading.grade_spr("5", accepted)[0])

    def test_mcq_is_case_insensitive(self):
        self.assertEqual(grading.grade_mcq("b", ["B"]), (True, "listed"))
        self.assertEqual(grading.grade_mcq("C", ["B"]), (False, None))

    def test_review_payload_carries_every_accepted_form(self):
        question = {"id": "x", "type": "spr", "correct": ["10/3", "3.75"],
                    "rationale_html": "<p>r</p>"}
        result = grading.grade(question, "3.75")
        self.assertTrue(result["correct"])
        self.assertEqual(result["accepted"], ["10/3", "3.75"])


class TestSplitExplanations(unittest.TestCase):
    def test_four_choices_split_and_classify(self):
        html = ("<p>Choice B is the best answer because it works. "
                "Choice A is incorrect because no. Choice C is incorrect because no. "
                "Choice D is incorrect because no.</p>")
        parts, flags = rationale.split_explanations(html)
        self.assertEqual(flags, [])
        self.assertEqual(sorted(parts), ["A", "B", "C", "D"])
        self.assertEqual(rationale.classify(parts["B"]), "correct")
        self.assertEqual(rationale.classify(parts["A"]), "incorrect")

    def test_nbsp_between_choice_and_is(self):
        # 2b5d289b
        html = ("<p>Choice A&nbsp;is the best answer. Yes. Choice B is incorrect. No. "
                "Choice C is incorrect. No. Choice D&nbsp;is incorrect. No.</p>")
        parts, flags = rationale.split_explanations(html)
        self.assertEqual(flags, [])
        self.assertEqual(rationale.classify(parts["A"]), "correct")

    def test_letter_wrapped_in_a_tag(self):
        # 028920-DC
        html = ('<p>Choice D is correct. Yes. Choice A is incorrect. No. '
                'Choice B is incorrect. No. '
                'Choice <span class="italic">C</span> is incorrect. No.</p>')
        parts, flags = rationale.split_explanations(html)
        self.assertEqual(flags, [])
        self.assertIn("C", parts)

    def test_grouped_rejection(self):
        # c324ef1d
        html = ("<p>Choice D is correct. Because reasons. "
                "Choices A, B, and C are incorrect and may result from conceptual errors.</p>")
        parts, flags = rationale.split_explanations(html)
        self.assertEqual(flags, [])
        self.assertEqual(sorted(parts), ["A", "B", "C", "D"])
        self.assertEqual(parts["A"], parts["B"])
        self.assertEqual(rationale.classify(parts["A"]), "incorrect")

    def test_grouped_rejection_singular_and_adverb(self):
        # 026230-DC "Choice B, C, and D are incorrect"; 04108-DC "are also incorrect"
        for lead in ("Choice B, C, and D are incorrect.",
                     "Choices B, C, and D are also incorrect."):
            parts, flags = rationale.split_explanations("<p>Choice A is correct. Yes. " + lead + "</p>")
            self.assertEqual(flags, [], lead)
            self.assertEqual(sorted(parts), ["A", "B", "C", "D"], lead)

    def test_individual_explanation_beats_grouped(self):
        # 08453-DC carries both forms; the specific one must win
        html = ("<p>Choice C is correct. Yes. "
                "Choices A, B, and D are incorrect and are the result of an error. "
                "Choice A is incorrect because the graphs intersect. "
                "Choice B is incorrect because of one intersection. "
                "Choice D is incorrect because a line cannot intersect twice.</p>")
        parts, flags = rationale.split_explanations(html)
        self.assertEqual(flags, [])
        self.assertIn("the graphs intersect", parts["A"])
        self.assertNotIn("the result of an error", parts["A"])

    def test_midsentence_reference_is_not_a_boundary(self):
        # 9025546d: "...choice D is the only graph that passes through..."
        html = ("<p>Choice D is correct. It is given that x is 2, so choice D is the only "
                "graph that passes through the point. Choice A is incorrect. No. "
                "Choice B is incorrect. No. Choice C is incorrect. No.</p>")
        parts, flags = rationale.split_explanations(html)
        self.assertEqual(flags, [])
        self.assertIn("only graph that passes through", parts["D"])

    def test_plural_reference_without_are_incorrect_is_not_a_boundary(self):
        # dbe25324: "Choices B and D show models of the form ..."
        html = ("<p>Choice B is correct. Choices B and D show models of the form y = mx. "
                "Choice A is incorrect. No. Choice C is incorrect. No. "
                "Choice D is incorrect. No.</p>")
        parts, flags = rationale.split_explanations(html)
        self.assertEqual(flags, [])
        self.assertIn("show models of the form", parts["B"])

    def test_sentence_ends_with_closing_quote(self):
        # 27c4515e: '...antecedents "poems" and "works."</p><p>Choice B is incorrect.'
        html = ('<p>Choice A is the best answer. It agrees with "poems" and "works."</p>'
                '<p>Choice B is incorrect. No.</p><p>Choice C is incorrect. No.</p>'
                '<p>Choice D is incorrect. No.</p>')
        parts, flags = rationale.split_explanations(html)
        self.assertEqual(flags, [])
        self.assertEqual(sorted(parts), ["A", "B", "C", "D"])

    def test_header_with_br_counts_as_sentence_start(self):
        # 01239-DC
        html = ("<p>Correct Answer Rationale<br>\nChoice C is correct. Yes."
                "<p>Incorrect Answer Rationale<br>\nChoices A, B, and D are incorrect. No.")
        parts, flags = rationale.split_explanations(html)
        self.assertEqual(flags, [])
        self.assertEqual(sorted(parts), ["A", "B", "C", "D"])

    def test_missing_explanation_is_flagged_not_invented(self):
        html = "<p>Choice D is correct. Yes. Choice B is incorrect. No.</p>"
        parts, flags = rationale.split_explanations(html)
        self.assertIn("missing_explanations_AC", flags)
        self.assertNotIn("A", parts)

    def test_returned_html_is_balanced(self):
        # Cutting mid-paragraph leaves A with an unclosed <p> and B with an
        # orphan </p>; both must come back well formed.
        html = "<p>Choice A is correct. Yes. Choice B is incorrect. No.</p>"
        parts, _ = rationale.split_explanations(html, labels=("A", "B"))
        for part in parts.values():
            self.assertEqual(part.count("<p>"), part.count("</p>"), part)
        self.assertTrue(parts["A"].startswith("Choice A"))
        self.assertTrue(parts["B"].startswith("Choice B"))

    def test_unclosed_tag_is_closed(self):
        html = "<p><em>Choice A is correct. Yes.</em> Text. <p>Choice B is incorrect."
        parts, _ = rationale.split_explanations(html, labels=("A", "B"))
        self.assertEqual(parts["A"].count("<p>"), parts["A"].count("</p>"))
        self.assertEqual(parts["A"].count("<em>"), parts["A"].count("</em>"))


class TestKeyRecovery(unittest.TestCase):
    def test_ways_to_enter_wins_over_prose(self):
        # 070615-DC: prose says "three halves", the enterable forms are 3/2 and 1.5
        text = ("<p>The correct answer is three halves. Note that 3/2 and 1.5 are examples "
                "of ways to enter a correct answer.</p>")
        answers, flags = rationale.recover_spr_answers(text)
        self.assertEqual(flags, [])
        self.assertEqual(answers, ["3/2", "1.5"])

    def test_leading_decimal_point_survives(self):
        # 070632-DC: .1667 must not become 1667
        text = ("<p>The correct answer is one sixth. Note that 1/6, .1666, .1667, 0.166, "
                "and 0.167 are examples of ways to enter a correct answer.</p>")
        answers, _ = rationale.recover_spr_answers(text)
        self.assertEqual(answers, ["1/6", ".1666", ".1667", "0.166", "0.167"])

    def test_decimal_answer_is_not_truncated_at_the_point(self):
        answers, flags = rationale.recover_spr_answers("<p>The correct answer is 0.25.</p>")
        self.assertEqual(flags, [])
        self.assertEqual(answers, ["0.25"])

    def test_thousands_comma(self):
        # 070922-DC
        answers, flags = rationale.recover_spr_answers("<p>The correct answer is 3,540.</p>")
        self.assertEqual(flags, [])
        self.assertEqual(answers, ["3540"])

    def test_img_alt_text_is_promoted(self):
        text = '<p>The correct answer is <img src="data:image/png;base64,AAA" alt="117">.</p>'
        answers, _ = rationale.recover_spr_answers(text)
        self.assertEqual(answers, ["117"])

    def test_prose_only_answer_is_flagged_not_guessed(self):
        answers, flags = rationale.recover_spr_answers("<p>The correct answer is e.</p>")
        self.assertEqual(answers, [])
        self.assertEqual(flags, ["spr_answer_not_numeric"])

    def test_mcq_recovery_requires_exactly_one_letter(self):
        letter, flags = rationale.recover_mcq_answer("<p>Choice C is the best answer.</p>")
        self.assertEqual((letter, flags), ("C", []))

    def test_mcq_ambiguity_is_flagged_not_guessed(self):
        letter, flags = rationale.recover_mcq_answer(
            "<p>Choice C is correct. Choice A is the best answer.</p>")
        self.assertIsNone(letter)
        self.assertEqual(flags, ["mcq_ambiguous_AC"])


class TestShuffleKey(unittest.TestCase):
    """The practice set is ordered by db.shuffle_key. Three properties matter:
    it must not change between runs, it must actually interleave, and it must
    agree exactly with web/src/lib/shuffle.ts, which sorts the static build.
    """

    def test_stable_across_processes(self):
        # Pinned literals, shared with web/src/lib/shuffle.test.ts. If these
        # change, every saved question number silently points at a different
        # question, so this must fail loudly rather than be updated to match.
        self.assertEqual(
            db.shuffle_key("002fb221-07c6-4406-a00c-ed57339ea78c"), 6465008710589730716)
        self.assertEqual(db.shuffle_key("015193-DC"), 4362093292545599972)
        self.assertEqual(db.shuffle_key(""), 8442584544778250395)
        self.assertEqual(db.shuffle_key("a"), 198367012849983736)

    def test_key_fits_a_signed_sqlite_integer(self):
        for qid in ("015193-DC", "a" * 200, "", "−4"):
            self.assertGreaterEqual(db.shuffle_key(qid), 0)
            self.assertLess(db.shuffle_key(qid), 2 ** 63)

    def test_interleaves_the_sections(self):
        # Without shuffling, MATH sorts before RW and you get ~1,900 math
        # questions before the first reading one.
        ids = [(f"m{i}", "MATH") for i in range(500)]
        ids += [(f"r{i}", "RW") for i in range(500)]
        ids.sort(key=lambda pair: db.shuffle_key(pair[0]))
        first_20 = [section for _, section in ids[:20]]
        self.assertIn("MATH", first_20)
        self.assertIn("RW", first_20)


# The pre-uuid attempts table, kept verbatim so the migration is tested against
# the shape that is actually on disk rather than a paraphrase of it.
LEGACY_ATTEMPTS_SCHEMA = """
CREATE TABLE attempts (
  id          INTEGER PRIMARY KEY,
  question_id TEXT NOT NULL REFERENCES questions(id),
  answered_at INTEGER NOT NULL,
  response    TEXT,
  correct     INTEGER NOT NULL,
  seconds     INTEGER
);
CREATE INDEX idx_a_question ON attempts(question_id);
CREATE INDEX idx_a_time     ON attempts(answered_at);
"""

# One SPR question, so attempts have something to reference under foreign_keys.
INSERT_QUESTION = (
    "INSERT INTO questions (id, source_path, section, domain, domain_name,"
    " skill, skill_name, difficulty, type, stem_html, correct_json,"
    " rationale_html, update_date)"
    " VALUES ('q1','external_id','MATH','H','Algebra','H.A.','Linear',"
    "'E','spr','stem','[\"4\"]','because',0)")


class TestAttemptIds(unittest.TestCase):
    """attempts.id is a uuid so two machines' histories can be merged by union.
    An INTEGER PRIMARY KEY counts per database, so both would mint id 5 and one
    of the two attempts would vanish in the merge.
    """

    def setUp(self):
        self.dir = tempfile.mkdtemp()
        self.path = os.path.join(self.dir, "t.db")

    def tearDown(self):
        shutil.rmtree(self.dir, ignore_errors=True)

    def _legacy_db(self, rows):
        """A database as it stood before the migration, holding `rows` attempts.

        Built by downgrading a real one rather than hand-writing a schema, so
        the fixture cannot drift from db.SCHEMA in any way except the column
        under test.
        """
        db.connect(self.path).close()
        conn = sqlite3.connect(self.path)
        conn.execute(INSERT_QUESTION)
        conn.executescript("""
            DROP INDEX IF EXISTS idx_a_question;
            DROP INDEX IF EXISTS idx_a_time;
            DROP TABLE attempts;
        """ + LEGACY_ATTEMPTS_SCHEMA)
        conn.executemany(
            "INSERT INTO attempts (question_id, answered_at, response, correct,"
            " seconds) VALUES (?,?,?,?,?)", rows)
        conn.commit()
        conn.close()

    def test_ids_are_uuids_not_a_counter(self):
        first, second = db.new_attempt_id(), db.new_attempt_id()
        self.assertNotEqual(first, second)
        self.assertEqual(uuid.UUID(first).version, 4)

    def test_fresh_database_declares_id_as_text(self):
        conn = db.connect(self.path)
        types = {c["name"]: c["type"]
                 for c in conn.execute("PRAGMA table_info(attempts)")}
        self.assertEqual(types["id"], "TEXT")
        conn.close()

    def test_migration_preserves_every_row_and_rewrites_the_ids(self):
        rows = [("q1", 1787198353, "A", 1, 8),
                ("q1", 1787198400, "B", 0, 41),
                ("q1", 1787198500, None, 0, None)]
        self._legacy_db(rows)

        conn = db.connect(self.path)
        migrated = conn.execute(
            "SELECT id, question_id, answered_at, response, correct, seconds"
            " FROM attempts ORDER BY answered_at").fetchall()

        self.assertEqual([tuple(r)[1:] for r in migrated], rows)
        ids = [r["id"] for r in migrated]
        self.assertEqual(len({uuid.UUID(i) for i in ids}), 3)
        # The scratch table must not survive, or the next connect() sees it.
        self.assertEqual(
            conn.execute("SELECT COUNT(*) FROM sqlite_master WHERE"
                         " name = 'attempts_legacy'").fetchone()[0], 0)
        conn.close()

    def test_migration_restores_both_indexes(self):
        # The indexes follow the table through the rename, so CREATE INDEX IF
        # NOT EXISTS would quietly leave the new table unindexed.
        self._legacy_db([("q1", 1787198353, "A", 1, 8)])
        conn = db.connect(self.path)
        indexed = {r["name"]: r["tbl_name"] for r in conn.execute(
            "SELECT name, tbl_name FROM sqlite_master WHERE type = 'index'")}
        self.assertEqual(indexed.get("idx_a_question"), "attempts")
        self.assertEqual(indexed.get("idx_a_time"), "attempts")
        conn.close()

    def test_migration_is_not_repeated(self):
        self._legacy_db([("q1", 1787198353, "A", 1, 8)])
        conn = db.connect(self.path)
        before = conn.execute("SELECT id FROM attempts").fetchone()["id"]
        conn.close()

        conn = db.connect(self.path)
        self.assertEqual(
            [r["id"] for r in conn.execute("SELECT id FROM attempts")], [before])
        conn.close()

    def test_submit_writes_a_uuid(self):
        conn = db.connect(self.path)
        conn.execute(INSERT_QUESTION)
        conn.commit()
        session.submit(conn, "q1", "4")
        stored = conn.execute("SELECT id FROM attempts").fetchone()["id"]
        self.assertEqual(uuid.UUID(stored).version, 4)
        conn.close()

class TestFilterSql(unittest.TestCase):
    """Practice-set filters are multi-select: OR inside one filter, AND between
    them. The trap is an empty list, which means "filter is off" and must never
    turn into `IN ()`, which matches nothing.
    """

    def test_no_filters_is_just_the_retired_guard(self):
        where, params = session._filter_sql()
        self.assertEqual(where, "q.retired = 0")
        self.assertEqual(params, [])

    def test_empty_lists_do_not_filter(self):
        # The UI sends undefined, but an empty array must behave the same way
        # rather than producing IN () and an empty practice set.
        where, params = session._filter_sql(
            domains=[], skills=[], difficulties=[], statuses=[])
        self.assertEqual(where, "q.retired = 0")
        self.assertEqual(params, [])

    def test_several_values_in_one_filter_are_ored(self):
        where, params = session._filter_sql(difficulties=["M", "H"])
        self.assertIn("q.difficulty IN (?,?)", where)
        self.assertEqual(params, ["M", "H"])

    def test_filters_are_anded_with_each_other(self):
        where, params = session._filter_sql(
            section="RW", domains=["INI", "CAS"], difficulties=["H"])
        self.assertIn("q.section = ?", where)
        self.assertIn("q.domain IN (?,?)", where)
        self.assertIn("q.difficulty IN (?)", where)
        self.assertEqual(where.count(" AND "), 3)
        self.assertEqual(params, ["RW", "INI", "CAS", "H"])

    def test_statuses_are_ored_in_their_own_group(self):
        # Without the brackets the OR would swallow the AND chain beside it and
        # every filter above would stop applying.
        where, _ = session._filter_sql(section="RW", statuses=["wrong", "flagged"])
        self.assertIn("(last.correct = 0 OR m.flagged = 1)", where)

    def test_unknown_status_is_ignored_not_injected(self):
        where, params = session._filter_sql(statuses=["../etc/passwd"])
        self.assertEqual(where, "q.retired = 0")
        self.assertEqual(params, [])

    def test_values_are_bound_never_interpolated(self):
        where, params = session._filter_sql(domains=["'; DROP TABLE questions --"])
        self.assertNotIn("DROP", where)
        self.assertEqual(params, ["'; DROP TABLE questions --"])


class TestQuestionSetFilters(unittest.TestCase):
    """The same rules, against a real database."""

    def setUp(self):
        self.dir = tempfile.mkdtemp()
        self.conn = db.connect(os.path.join(self.dir, "t.db"))
        rows = [
            ("q1", "RW", "INI", "Information and Ideas", "COE", "Evidence", "E"),
            ("q2", "RW", "INI", "Information and Ideas", "COE", "Evidence", "M"),
            ("q3", "RW", "CAS", "Craft and Structure", "WIC", "Words", "H"),
            ("q4", "MATH", "H", "Algebra", "H.A.", "Linear", "H"),
        ]
        for qid, section, domain, dname, skill, sname, diff in rows:
            self.conn.execute(
                "INSERT INTO questions (id, source_path, section, domain,"
                " domain_name, skill, skill_name, difficulty, type, stem_html,"
                " correct_json, rationale_html, update_date)"
                " VALUES (?,'external_id',?,?,?,?,?,?,'spr','stem','[\"4\"]','r',0)",
                (qid, section, domain, dname, skill, sname, diff))
        self.conn.commit()

    def tearDown(self):
        self.conn.close()
        shutil.rmtree(self.dir, ignore_errors=True)

    def ids(self, **kwargs):
        return sorted(r["id"] for r in session.question_set(self.conn, **kwargs))

    def test_no_filter_returns_everything(self):
        self.assertEqual(self.ids(), ["q1", "q2", "q3", "q4"])

    def test_two_difficulties(self):
        # The case that prompted this: medium AND hard, not one or the other.
        self.assertEqual(self.ids(difficulties=["M", "H"]), ["q2", "q3", "q4"])

    def test_two_domains(self):
        self.assertEqual(self.ids(domains=["INI", "CAS"]), ["q1", "q2", "q3"])

    def test_domains_and_difficulties_together(self):
        self.assertEqual(self.ids(domains=["INI", "CAS"], difficulties=["M", "H"]),
                         ["q2", "q3"])

    def test_section_still_narrows(self):
        self.assertEqual(self.ids(section="RW", difficulties=["H"]), ["q3"])

    def test_empty_lists_match_everything(self):
        self.assertEqual(self.ids(domains=[], difficulties=[]),
                         ["q1", "q2", "q3", "q4"])


class TestMistakeLog(unittest.TestCase):
    """Tags plus a note, one row per question. The rule worth pinning is that an
    empty log deletes the row: "never logged" and "logged then cleared" have to
    be the same thing, because the review page filters on presence.
    """

    def setUp(self):
        self.dir = tempfile.mkdtemp()
        self.conn = db.connect(os.path.join(self.dir, "t.db"))
        self.conn.execute(INSERT_QUESTION)
        self.conn.commit()

    def tearDown(self):
        self.conn.close()
        shutil.rmtree(self.dir, ignore_errors=True)

    def test_absent_until_written(self):
        self.assertIsNone(session.get_mistake(self.conn, "q1"))

    def test_round_trip(self):
        session.set_mistake(self.conn, "q1", tags=["silly", "knowledge"],
                            note="misread the sign")
        got = session.get_mistake(self.conn, "q1")
        self.assertEqual(got["tags"], ["silly", "knowledge"])
        self.assertEqual(got["note"], "misread the sign")

    def test_unknown_tags_are_dropped_not_stored(self):
        # A stale client must not be able to invent a category the review page
        # has no label for.
        session.set_mistake(self.conn, "q1", tags=["silly", "vibes", "<script>"])
        self.assertEqual(session.get_mistake(self.conn, "q1")["tags"], ["silly"])

    def test_clearing_removes_the_row(self):
        session.set_mistake(self.conn, "q1", tags=["other"], note="x")
        self.assertIsNone(session.set_mistake(self.conn, "q1", tags=[], note="   "))
        self.assertIsNone(session.get_mistake(self.conn, "q1"))

    def test_a_note_alone_is_enough(self):
        session.set_mistake(self.conn, "q1", tags=[], note="ran out of time")
        got = session.get_mistake(self.conn, "q1")
        self.assertEqual(got["tags"], [])
        self.assertEqual(got["note"], "ran out of time")

    def test_writing_twice_updates_rather_than_duplicating(self):
        session.set_mistake(self.conn, "q1", tags=["process"])
        session.set_mistake(self.conn, "q1", tags=["knowledge"])
        self.assertEqual(session.get_mistake(self.conn, "q1")["tags"], ["knowledge"])
        n = self.conn.execute("SELECT COUNT(*) FROM mistakes").fetchone()[0]
        self.assertEqual(n, 1)


class TestReviewOrder(unittest.TestCase):
    """The review page asks for answered questions, newest first."""

    def setUp(self):
        self.dir = tempfile.mkdtemp()
        self.conn = db.connect(os.path.join(self.dir, "t.db"))
        for qid in ("q1", "q2", "q3"):
            self.conn.execute(INSERT_QUESTION.replace("'q1'", f"'{qid}'"))
        # q2 answered most recently, q3 never answered.
        for qid, when in (("q1", 1000), ("q2", 2000)):
            self.conn.execute(
                "INSERT INTO attempts (id, question_id, answered_at, response,"
                " correct, seconds) VALUES (?,?,?,?,?,?)",
                (db.new_attempt_id(), qid, when, "4", 1, 12))
        self.conn.commit()

    def tearDown(self):
        self.conn.close()
        shutil.rmtree(self.dir, ignore_errors=True)

    def test_recent_order_puts_the_latest_answer_first(self):
        rows = session.question_set(self.conn, statuses=["correct", "wrong"],
                                    order="recent")
        self.assertEqual([r["id"] for r in rows], ["q2", "q1"])

    def test_unanswered_questions_are_excluded(self):
        rows = session.question_set(self.conn, statuses=["correct", "wrong"],
                                    order="recent")
        self.assertNotIn("q3", [r["id"] for r in rows])

    def test_attempts_for_returns_the_whole_run_oldest_first(self):
        # The set row only ever carries the LAST attempt. Review shows every
        # one, so you can see a question you got wrong before it stuck.
        for when, resp, ok in ((3000, "A", 0), (4000, "B", 0), (5000, "4", 1)):
            self.conn.execute(
                "INSERT INTO attempts (id, question_id, answered_at, response,"
                " correct, seconds) VALUES (?,?,?,?,?,?)",
                (db.new_attempt_id(), "q3", when, resp, ok, 20))
        self.conn.commit()
        got = session.attempts_for(self.conn, "q3")
        self.assertEqual([a["response"] for a in got], ["A", "B", "4"])
        self.assertEqual([a["correct"] for a in got], [0, 0, 1])

    def test_attempts_for_is_empty_when_never_answered(self):
        self.assertEqual(session.attempts_for(self.conn, "q3"), [])

    def test_the_row_carries_what_review_shows(self):
        row = session.question_set(self.conn, statuses=["correct", "wrong"],
                                   order="recent")[0]
        for field in ("last_response", "last_correct", "last_seconds",
                      "answered_at", "attempt_count"):
            self.assertIn(field, row.keys(), field)
        self.assertEqual(row["last_seconds"], 12)


if __name__ == "__main__":
    unittest.main(verbosity=2)
