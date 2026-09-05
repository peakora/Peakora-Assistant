# Copyright (c) 2026 Peakora. All rights reserved. Licensed under the MIT License; see NOTICE and LICENSE.
"""Tests for affiliate_partner_discovery. stdlib-only unittest suite."""
import unittest

from affiliate_partner_discovery import (
    PartnerDiscovery,
    _audience_to_traffic_score,
    _clamp,
)


class TestEvaluatePartner(unittest.TestCase):
    def setUp(self):
        self.pd = PartnerDiscovery()

    def test_high_fit_large_audience_is_high_priority(self):
        candidate = {
            "name": "DevTools Weekly",
            "url": "https://devtoolsweekly.com",
            "audience_size": 120000,
            "niche_fit_score": 0.9,
            "niche": "developer-tools",
        }
        ev = self.pd.evaluate_partner(candidate)
        self.assertGreaterEqual(ev["score"], 70.0)
        self.assertEqual(ev["outreach_priority"], "high")
        self.assertGreaterEqual(ev["traffic_score"], 0.0)
        self.assertLessEqual(ev["traffic_score"], 1.0)

    def test_low_fit_small_audience_is_low_priority(self):
        candidate = {
            "name": "Random Blog",
            "audience_size": 50,
            "niche_fit_score": 0.1,
        }
        ev = self.pd.evaluate_partner(candidate)
        self.assertLess(ev["score"], 40.0)
        self.assertEqual(ev["outreach_priority"], "low")

    def test_medium_threshold(self):
        candidate = {
            "name": "Mid Partner",
            "audience_size": 2000,
            "niche_fit_score": 0.5,
        }
        ev = self.pd.evaluate_partner(candidate)
        self.assertGreaterEqual(ev["score"], 40.0)
        self.assertLess(ev["score"], 70.0)
        self.assertEqual(ev["outreach_priority"], "medium")

    def test_score_bounds(self):
        for nf in [0.0, 0.25, 0.5, 0.75, 1.0]:
            for aud in [0, 10, 1000, 1_000_000]:
                ev = self.pd.evaluate_partner(
                    {"audience_size": aud, "niche_fit_score": nf}
                )
                self.assertGreaterEqual(ev["score"], 0.0)
                self.assertLessEqual(ev["score"], 100.0)

    def test_invalid_inputs_do_not_raise(self):
        ev = self.pd.evaluate_partner({"audience_size": "oops", "niche_fit_score": None})
        self.assertEqual(ev["outreach_priority"], "low")


class TestNicheFitWeighting(unittest.TestCase):
    def setUp(self):
        self.pd = PartnerDiscovery()

    def test_niche_fit_dominates_traffic(self):
        # High-fit small audience should beat low-fit huge audience.
        high_fit_small = self.pd.evaluate_partner(
            {"audience_size": 500, "niche_fit_score": 1.0}
        )
        low_fit_huge = self.pd.evaluate_partner(
            {"audience_size": 1_000_000, "niche_fit_score": 0.1}
        )
        self.assertGreater(high_fit_small["score"], low_fit_huge["score"])

    def test_relevance_equals_niche_fit(self):
        ev = self.pd.evaluate_partner({"niche_fit_score": 0.73})
        self.assertAlmostEqual(ev["relevance_score"], 0.73, places=2)

    def test_traffic_score_increases_with_audience(self):
        small = _audience_to_traffic_score(100)
        med = _audience_to_traffic_score(10_000)
        big = _audience_to_traffic_score(1_000_000)
        self.assertLess(small, med)
        self.assertLess(med, big)


class TestDiscoverAndHints(unittest.TestCase):
    def test_from_search_hints_builds_candidates(self):
        pd = PartnerDiscovery()
        hints = [
            ("DevTools Weekly", "https://devtoolsweekly.com"),
            ("YouTube Dev Channel", "https://youtube.com/@dev"),
        ]
        built = pd.from_search_hints(hints, niche="developer-tools")
        self.assertEqual(len(built), 2)
        self.assertEqual(built[0]["name"], "DevTools Weekly")
        self.assertEqual(built[1]["platform"], "youtube")
        # niche hint matched in name -> fit should be elevated
        self.assertGreater(built[0]["niche_fit_score"], 0.5)

    def test_discover_ranks_and_limits(self):
        pd = PartnerDiscovery()
        pd.add_candidates([
            {"name": "A", "audience_size": 50000, "niche_fit_score": 0.9, "niche": "saas"},
            {"name": "B", "audience_size": 100, "niche_fit_score": 0.2, "niche": "saas"},
            {"name": "C", "audience_size": 5000, "niche_fit_score": 0.6, "niche": "other"},
        ])
        ranked = pd.discover_niche_partners("saas", max_results=10)
        # only saas-niche candidates returned
        self.assertEqual(len(ranked), 2)
        self.assertEqual(ranked[0]["name"], "A")
        self.assertEqual(ranked[1]["name"], "B")

    def test_discover_max_results_cap(self):
        pd = PartnerDiscovery()
        pd.add_candidates([
            {"name": f"n{i}", "audience_size": 1000, "niche_fit_score": 0.5, "niche": "x"}
            for i in range(10)
        ])
        self.assertEqual(len(pd.discover_niche_partners("x", max_results=3)), 3)


class TestOutreachSequence(unittest.TestCase):
    def setUp(self):
        self.pd = PartnerDiscovery()
        self.terms = {
            "commission_rate": "30% recurring",
            "cookie_window": "90-day",
            "payout_methods": ["Stripe", "PayPal"],
        }

    def test_returns_three_drafts(self):
        seq = self.pd.draft_outreach_sequence(
            {"name": "Acme", "niche": "productivity"}, self.terms
        )
        self.assertEqual(len(seq), 3)

    def test_each_draft_is_personalized(self):
        seq = self.pd.draft_outreach_sequence(
            {"name": "Acme", "niche": "productivity"}, self.terms
        )
        for draft in seq:
            self.assertIn("Acme", draft)
        # commission + cookie + payout appear at least once across the sequence
        joined = "\n".join(seq)
        self.assertIn("30% recurring", joined)
        self.assertIn("90-day", joined)
        self.assertIn("Stripe", joined)
        self.assertIn("PayPal", joined)

    def test_no_emoji_in_drafts(self):
        seq = self.pd.draft_outreach_sequence(
            {"name": "Acme", "niche": "productivity"}, self.terms
        )
        for draft in seq:
            self.assertFalse(any(ord(ch) > 0x1F000 for ch in draft),
                            "emoji found in outreach draft")

    def test_tone_does_not_break(self):
        for tone in ["warm", "formal", "casual", "weird"]:
            seq = self.pd.draft_outreach_sequence({"name": "X", "niche": "y"}, self.terms, tone=tone)
            self.assertEqual(len(seq), 3)


class TestClampHelper(unittest.TestCase):
    def test_clamp_bounds(self):
        self.assertEqual(_clamp(-5), 0.0)
        self.assertEqual(_clamp(5), 1.0)
        self.assertAlmostEqual(_clamp(0.5), 0.5)


if __name__ == "__main__":
    unittest.main()
