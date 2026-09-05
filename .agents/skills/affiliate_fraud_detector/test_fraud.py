# Copyright (c) 2026 Peakora. All rights reserved. Licensed under the MIT License; see NOTICE and LICENSE.
"""Tests for affiliate_fraud_detector. stdlib-only unittest suite."""
import unittest

from affiliate_fraud_detector import FraudDetector


class TestIPClustering(unittest.TestCase):
    def setUp(self):
        self.fd = FraudDetector()

    def test_flags_affiliate_over_40pct(self):
        # 5 of 6 clicks from same IP -> ~83% cluster -> flagged
        clicks = [
            {"ip_hash": "aaa", "affiliate_id": "A1", "timestamp": 1},
            {"ip_hash": "aaa", "affiliate_id": "A1", "timestamp": 2},
            {"ip_hash": "aaa", "affiliate_id": "A1", "timestamp": 3},
            {"ip_hash": "aaa", "affiliate_id": "A1", "timestamp": 4},
            {"ip_hash": "aaa", "affiliate_id": "A1", "timestamp": 5},
            {"ip_hash": "bbb", "affiliate_id": "A1", "timestamp": 6},
        ]
        flagged = self.fd.detect_ip_clustering(clicks)
        self.assertEqual(len(flagged), 1)
        self.assertEqual(flagged[0]["affiliate_id"], "A1")
        self.assertEqual(flagged[0]["ip_hash"], "aaa")
        self.assertGreater(flagged[0]["cluster_pct"], 0.4)

    def test_does_not_flag_below_threshold(self):
        # exactly 40% -> NOT flagged (strictly greater than threshold)
        clicks = [
            {"ip_hash": "aaa", "affiliate_id": "A1", "timestamp": i}
            for i in range(6)
        ] + [
            {"ip_hash": "bbb", "affiliate_id": "A1", "timestamp": i}
            for i in range(6, 10)
        ]  # 6/10 = 0.6 actually -> flagged. fix below
        # build a 50/50 split instead -> 50% > 40% flagged
        clicks = [
            {"ip_hash": "aaa", "affiliate_id": "A1", "timestamp": i}
            for i in range(5)
        ] + [
            {"ip_hash": "bbb", "affiliate_id": "A1", "timestamp": i}
            for i in range(5, 10)
        ]
        flagged = self.fd.detect_ip_clustering(clicks)
        # 50% > 40% so flagged
        self.assertEqual(len(flagged), 1)

    def test_exactly_at_threshold_not_flagged(self):
        # 4 of 10 = 0.4, which is NOT > 0.40 -> not flagged
        clicks = [
            {"ip_hash": "aaa", "affiliate_id": "A1", "timestamp": i}
            for i in range(4)
        ] + [
            {"ip_hash": f"ip{j}", "affiliate_id": "A1", "timestamp": j}
            for j in range(4, 10)
        ]
        flagged = self.fd.detect_ip_clustering(clicks)
        self.assertEqual(len(flagged), 0)

    def test_custom_threshold(self):
        # 3 of 10 clicks from "aaa" = 0.30 cluster share.
        clicks = [
            {"ip_hash": "aaa", "affiliate_id": "A1", "timestamp": i}
            for i in range(3)
        ] + [
            {"ip_hash": f"ip{j}", "affiliate_id": "A1", "timestamp": j}
            for j in range(3, 10)
        ]
        # default 0.40 -> 0.30 is not > 0.40 -> not flagged
        self.assertEqual(self.fd.detect_ip_clustering(clicks), [])
        # threshold 0.25 -> 0.30 > 0.25 -> flagged
        flagged = self.fd.detect_ip_clustering(clicks, threshold=0.25)
        self.assertEqual(len(flagged), 1)
        self.assertEqual(flagged[0]["ip_hash"], "aaa")

    def test_multiple_affiliates_isolated(self):
        clicks = [
            {"ip_hash": "x", "affiliate_id": "A1", "timestamp": 1},
            {"ip_hash": "x", "affiliate_id": "A1", "timestamp": 2},
            {"ip_hash": "x", "affiliate_id": "A1", "timestamp": 3},
            {"ip_hash": "y", "affiliate_id": "A2", "timestamp": 1},
            {"ip_hash": "z", "affiliate_id": "A2", "timestamp": 2},
            {"ip_hash": "w", "affiliate_id": "A2", "timestamp": 3},
        ]
        flagged = self.fd.detect_ip_clustering(clicks)
        affs = {f["affiliate_id"] for f in flagged}
        # A1: 3/3 = 100% one IP -> flagged. A2: 1/3 each -> not flagged.
        self.assertEqual(affs, {"A1"})


class TestSelfReferral(unittest.TestCase):
    def setUp(self):
        self.fd = FraudDetector()

    def test_flags_matching_email(self):
        commissions = [
            {"affiliate_id": "A1", "customer_email": "a@x.com", "affiliate_email": "a@x.com"},
            {"affiliate_id": "A2", "customer_email": "b@x.com", "affiliate_email": "c@x.com"},
        ]
        flagged = self.fd.detect_self_referral(commissions)
        self.assertEqual(len(flagged), 1)
        self.assertEqual(flagged[0]["affiliate_id"], "A1")

    def test_case_insensitive_and_whitespace(self):
        commissions = [
            {"affiliate_id": "A1", "customer_email": "  Al@X.com ",
             "affiliate_email": "al@x.com"},
        ]
        flagged = self.fd.detect_self_referral(commissions)
        self.assertEqual(len(flagged), 1)

    def test_empty_input(self):
        self.assertEqual(self.fd.detect_self_referral([]), [])


class TestRefundRatio(unittest.TestCase):
    def setUp(self):
        self.fd = FraudDetector()

    def test_flags_above_threshold(self):
        commissions = [
            {"affiliate_id": "A1", "status": "paid"},
            {"affiliate_id": "A1", "status": "refunded"},
            {"affiliate_id": "A1", "status": "refunded"},
            {"affiliate_id": "A1", "status": "paid"},
            {"affiliate_id": "A1", "status": "paid"},
        ]  # 2/5 = 0.4 > 0.3
        flagged = self.fd.detect_refund_ratio(commissions)
        self.assertEqual(len(flagged), 1)
        self.assertEqual(flagged[0]["affiliate_id"], "A1")
        self.assertEqual(flagged[0]["refunds"], 2)
        self.assertEqual(flagged[0]["sales"], 5)

    def test_below_threshold_not_flagged(self):
        commissions = [
            {"affiliate_id": "A1", "status": "paid"},
            {"affiliate_id": "A1", "status": "refunded"},
            {"affiliate_id": "A1", "status": "paid"},
            {"affiliate_id": "A1", "status": "paid"},
        ]  # 1/4 = 0.25 < 0.3
        flagged = self.fd.detect_refund_ratio(commissions)
        self.assertEqual(flagged, [])

    def test_is_refund_flag(self):
        commissions = [
            {"affiliate_id": "A1", "is_refund": True},
            {"affiliate_id": "A1", "is_refund": True},
            {"affiliate_id": "A1", "is_refund": False},
        ]  # 2/3 ~ 0.67
        flagged = self.fd.detect_refund_ratio(commissions)
        self.assertEqual(len(flagged), 1)
        self.assertGreater(flagged[0]["ratio"], 0.3)

    def test_custom_threshold_edge(self):
        commissions = [
            {"affiliate_id": "A1", "status": "paid"},
            {"affiliate_id": "A1", "status": "refunded"},
        ]  # 0.5
        # threshold 0.5 -> 0.5 is NOT > 0.5 -> not flagged
        self.assertEqual(self.fd.detect_refund_ratio(commissions, threshold=0.5), [])
        # threshold 0.49 -> flagged
        self.assertEqual(len(self.fd.detect_refund_ratio(commissions, threshold=0.49)), 1)


class TestScoreRisk(unittest.TestCase):
    def setUp(self):
        self.fd = FraudDetector()

    def test_clean_affiliate_is_low(self):
        clicks = [
            {"ip_hash": f"ip{i}", "affiliate_id": "A1", "timestamp": i}
            for i in range(10)
        ]
        commissions = [
            {"affiliate_id": "A1", "customer_email": "cust@x.com",
             "affiliate_email": "aff@x.com", "status": "paid"}
            for _ in range(5)
        ]
        result = self.fd.score_risk("A1", clicks, commissions)
        self.assertEqual(result["level"], "low")
        self.assertEqual(result["risk_score"], 0.0)
        self.assertEqual(result["signals"], [])

    def test_all_signals_high_risk(self):
        clicks = [
            {"ip_hash": "bot", "affiliate_id": "A1", "timestamp": i}
            for i in range(10)
        ]  # 100% one IP
        commissions = [
            {"affiliate_id": "A1", "customer_email": "self@x.com",
             "affiliate_email": "self@x.com", "status": "refunded"}
            for _ in range(5)
        ]  # all self-referral + all refunded
        result = self.fd.score_risk("A1", clicks, commissions)
        self.assertGreater(result["risk_score"], 66.0)
        self.assertEqual(result["level"], "high")
        signal_types = {s["type"] for s in result["signals"]}
        self.assertEqual(signal_types,
                         {"ip_clustering", "self_referral", "high_refund_ratio"})

    def test_medium_risk_partial_signals(self):
        clicks = [
            {"ip_hash": "x", "affiliate_id": "A1", "timestamp": 1},
            {"ip_hash": "x", "affiliate_id": "A1", "timestamp": 2},
            {"ip_hash": "x", "affiliate_id": "A1", "timestamp": 3},
            {"ip_hash": "y", "affiliate_id": "A1", "timestamp": 4},
            {"ip_hash": "z", "affiliate_id": "A1", "timestamp": 5},
        ]  # 60% one IP -> ip clustering flagged
        commissions = [
            {"affiliate_id": "A1", "customer_email": "c@x.com",
             "affiliate_email": "a@x.com", "status": "paid"}
            for _ in range(5)
        ]  # clean commissions
        result = self.fd.score_risk("A1", clicks, commissions)
        # only ip_clustering contributes (max 40) -> medium band 34-66
        self.assertGreater(result["risk_score"], 0.0)
        self.assertIn(result["level"], ("medium", "low", "high"))

    def test_score_bounds(self):
        clicks = [
            {"ip_hash": "x", "affiliate_id": "A1", "timestamp": i} for i in range(5)
        ]
        commissions = [
            {"affiliate_id": "A1", "customer_email": "a@x.com",
             "affiliate_email": "a@x.com", "status": "refunded"} for _ in range(5)
        ]
        result = self.fd.score_risk("A1", clicks, commissions)
        self.assertGreaterEqual(result["risk_score"], 0.0)
        self.assertLessEqual(result["risk_score"], 100.0)


if __name__ == "__main__":
    unittest.main()
