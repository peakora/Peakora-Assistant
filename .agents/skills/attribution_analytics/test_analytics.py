# Copyright (c) 2026 Peakora. All rights reserved. Licensed under the MIT License; see NOTICE and LICENSE.
"""Tests for attribution_analytics. stdlib-only unittest suite."""
import unittest

from attribution_analytics import AttributionAnalytics


class TestPerformanceSummary(unittest.TestCase):
    def setUp(self):
        self.aa = AttributionAnalytics()

    def test_basic_math(self):
        clicks = [
            {"affiliate_id": "A1", "timestamp": 1},
            {"affiliate_id": "A1", "timestamp": 2},
            {"affiliate_id": "A2", "timestamp": 3},
            {"affiliate_id": "A2", "timestamp": 4},
        ]
        commissions = [
            {"affiliate_id": "A1", "commission_amount": 100},
            {"affiliate_id": "A1", "commission_amount": 50},
            {"affiliate_id": "A2", "commission_amount": 25},
        ]
        s = self.aa.performance_summary(clicks, commissions)
        self.assertEqual(s["total_clicks"], 4)
        self.assertEqual(s["total_conversions"], 3)
        self.assertAlmostEqual(s["conversion_rate"], 0.75, places=2)
        self.assertEqual(s["total_commission"], 175.0)
        self.assertAlmostEqual(s["avg_commission"], 175.0 / 3, places=2)
        self.assertEqual(s["active_partners"], 2)

    def test_refunds_excluded_from_conversions(self):
        clicks = [{"affiliate_id": "A1"} for _ in range(10)]
        commissions = [
            {"affiliate_id": "A1", "commission_amount": 100, "status": "paid"},
            {"affiliate_id": "A1", "commission_amount": 30, "status": "refunded"},
        ]
        s = self.aa.performance_summary(clicks, commissions)
        self.assertEqual(s["total_conversions"], 1)
        self.assertEqual(s["total_commission"], 100.0)
        self.assertAlmostEqual(s["conversion_rate"], 0.1, places=2)

    def test_empty_inputs(self):
        s = self.aa.performance_summary([], [])
        self.assertEqual(s["total_clicks"], 0)
        self.assertEqual(s["total_conversions"], 0)
        self.assertEqual(s["conversion_rate"], 0.0)
        self.assertEqual(s["active_partners"], 0)

    def test_zero_clicks_no_division_error(self):
        s = self.aa.performance_summary([], [{"affiliate_id": "A1", "commission_amount": 10}])
        self.assertEqual(s["conversion_rate"], 0.0)
        self.assertEqual(s["total_conversions"], 1)


class TestTopPartners(unittest.TestCase):
    def setUp(self):
        self.aa = AttributionAnalytics()

    def test_sorted_desc(self):
        commissions = [
            {"affiliate_id": "A1", "commission_amount": 100},
            {"affiliate_id": "A2", "commission_amount": 500},
            {"affiliate_id": "A3", "commission_amount": 50},
        ]
        ranked = self.aa.top_partners(commissions)
        self.assertEqual([r["affiliate_id"] for r in ranked], ["A2", "A1", "A3"])
        self.assertEqual(ranked[0]["total_commission"], 500.0)

    def test_aggregates_per_affiliate(self):
        commissions = [
            {"affiliate_id": "A1", "commission_amount": 100},
            {"affiliate_id": "A1", "commission_amount": 100},
            {"affiliate_id": "A2", "commission_amount": 150},
        ]
        ranked = self.aa.top_partners(commissions)
        self.assertEqual(ranked[0]["affiliate_id"], "A1")
        self.assertEqual(ranked[0]["total_commission"], 200.0)
        self.assertEqual(ranked[0]["conversions"], 2)
        self.assertEqual(ranked[0]["avg_commission"], 100.0)

    def test_limit(self):
        commissions = [
            {"affiliate_id": f"A{i}", "commission_amount": 100 - i}
            for i in range(5)
        ]
        ranked = self.aa.top_partners(commissions, limit=3)
        self.assertEqual(len(ranked), 3)

    def test_refunds_excluded(self):
        commissions = [
            {"affiliate_id": "A1", "commission_amount": 100, "status": "paid"},
            {"affiliate_id": "A1", "commission_amount": 999, "status": "refunded"},
            {"affiliate_id": "A2", "commission_amount": 50, "status": "paid"},
        ]
        ranked = self.aa.top_partners(commissions)
        self.assertEqual(ranked[0]["affiliate_id"], "A1")
        self.assertEqual(ranked[0]["total_commission"], 100.0)


class TestCohortRetention(unittest.TestCase):
    def setUp(self):
        self.aa = AttributionAnalytics()

    def test_simple_retention(self):
        # 2 customers sign up in Jan. Both commission in month 1; one in month 2.
        commissions = [
            {"affiliate_id": "A1", "customer_id": "c1",
             "created_at": "2024-01-05", "commission_amount": 10},
            {"affiliate_id": "A1", "customer_id": "c2",
             "created_at": "2024-01-10", "commission_amount": 10},
            {"affiliate_id": "A1", "customer_id": "c1",
             "created_at": "2024-02-08", "commission_amount": 10},
        ]
        rows = self.aa.cohort_retention(commissions, cohort_months=3)
        self.assertEqual(len(rows), 1)
        row = rows[0]
        self.assertEqual(row["cohort_month"], "2024-01")
        self.assertEqual(row["size"], 2)
        # month 1: both active -> 1.0
        self.assertAlmostEqual(row["retention_by_month"][1], 1.0, places=2)
        # month 2: only c1 -> 0.5
        self.assertAlmostEqual(row["retention_by_month"][2], 0.5, places=2)
        # month 3: none -> 0.0
        self.assertAlmostEqual(row["retention_by_month"][3], 0.0, places=2)

    def test_multiple_cohorts(self):
        commissions = [
            {"affiliate_id": "A1", "customer_id": "c1",
             "created_at": "2024-01-01", "commission_amount": 10},
            {"affiliate_id": "A1", "customer_id": "c2",
             "created_at": "2024-02-01", "commission_amount": 10},
        ]
        rows = self.aa.cohort_retention(commissions, cohort_months=2)
        self.assertEqual(len(rows), 2)
        self.assertEqual(rows[0]["cohort_month"], "2024-01")
        self.assertEqual(rows[1]["cohort_month"], "2024-02")
        # each cohort size 1
        self.assertEqual(rows[0]["size"], 1)
        self.assertEqual(rows[1]["size"], 1)

    def test_refunds_excluded_from_cohort(self):
        commissions = [
            {"affiliate_id": "A1", "customer_id": "c1",
             "created_at": "2024-01-01", "commission_amount": 10, "status": "refunded"},
        ]
        rows = self.aa.cohort_retention(commissions, cohort_months=3)
        self.assertEqual(rows, [])

    def test_partner_cohort_report_scoped(self):
        commissions = [
            {"affiliate_id": "A1", "customer_id": "c1",
             "created_at": "2024-01-01", "commission_amount": 10},
            {"affiliate_id": "A2", "customer_id": "c2",
             "created_at": "2024-01-05", "commission_amount": 10},
        ]
        rows = self.aa.partner_cohort_report(commissions, "A1")
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["affiliate_id"], "A1")
        self.assertEqual(rows[0]["size"], 1)
        # A2's commission excluded
        rows2 = self.aa.partner_cohort_report(commissions, "A2")
        self.assertEqual(rows2[0]["affiliate_id"], "A2")
        self.assertEqual(rows2[0]["size"], 1)

    def test_retention_keys_are_consecutive_months(self):
        commissions = [
            {"affiliate_id": "A1", "customer_id": "c1",
             "created_at": "2024-01-01", "commission_amount": 10},
        ]
        rows = self.aa.cohort_retention(commissions, cohort_months=4)
        retention = rows[0]["retention_by_month"]
        self.assertEqual(sorted(retention.keys()), [1, 2, 3, 4])

    def test_empty_input(self):
        self.assertEqual(self.aa.cohort_retention([], cohort_months=6), [])


class TestDateParsing(unittest.TestCase):
    def setUp(self):
        self.aa = AttributionAnalytics()

    def test_iso_and_epoch(self):
        # both rows land in Jan 2024
        commissions = [
            {"affiliate_id": "A1", "customer_id": "c1",
             "created_at": "2024-01-15T12:00:00", "commission_amount": 10},
            {"affiliate_id": "A1", "customer_id": "c2",
             "created_at": 1705276800, "commission_amount": 10},  # 2024-01-15
        ]
        rows = self.aa.cohort_retention(commissions, cohort_months=1)
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["size"], 2)


if __name__ == "__main__":
    unittest.main()
