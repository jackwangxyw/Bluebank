"""Regression tests. Every case here is a real shape found in the bank, not a
made-up example; the comment names the question it came from.
"""
import unittest

from satbluebank import db, grading, rationale


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


if __name__ == "__main__":
    unittest.main(verbosity=2)
