# Copyright (c) 2026 Peakora. All rights reserved. Licensed under the MIT License; see NOTICE and LICENSE.
"""affiliate_fraud_detector  -  affiliate program anomaly detection.

Detects three common affiliate-abuse patterns and combines them into a single
0-100 risk score per affiliate:

  * IP clustering     -  >40% of an affiliate's clicks from one IP hash.
  * Self-referral     -  customer_email == affiliate_email on a commission.
  * Refund ratio      -  refunds / sales above a configurable threshold.

stdlib-only, no external dependencies.
"""
from __future__ import annotations

from collections import defaultdict
from typing import Any, Dict, List, Optional, Sequence


# Sensible, overridable constants.
DEFAULT_CLUSTER_THRESHOLD = 0.40  # >40% from one IP => suspicious
DEFAULT_REFUND_THRESHOLD = 0.30


def _safe_get(record: Dict[str, Any], key: str, default: Any = None) -> Any:
    try:
        return record.get(key, default)
    except AttributeError:
        return default


def _emails_match(a: Optional[str], b: Optional[str]) -> bool:
    if not a or not b:
        return False
    return str(a).strip().lower() == str(b).strip().lower()


class FraudDetector:
    """Detect affiliate fraud signals and compute composite risk scores."""

    # ----------------------------------------------------------- IP cluster
    def detect_ip_clustering(
        self,
        clicks: Sequence[Dict[str, Any]],
        threshold: float = DEFAULT_CLUSTER_THRESHOLD,
    ) -> List[Dict[str, Any]]:
        """Flag affiliates where more than `threshold` of their clicks come
        from a single IP hash.

        Args:
            clicks: list of {ip_hash, affiliate_id, timestamp}
            threshold: fraction in (0, 1]; default 0.40.

        Returns:
            list of {affiliate_id, reason, ip_hash, cluster_pct, click_count}
            sorted by cluster_pct desc.
        """
        if not clicks:
            return []
        try:
            threshold = float(threshold)
        except (TypeError, ValueError):
            threshold = DEFAULT_CLUSTER_THRESHOLD
        if not (0.0 < threshold <= 1.0):
            threshold = DEFAULT_CLUSTER_THRESHOLD

        per_affiliate: Dict[str, Dict[str, int]] = defaultdict(lambda: defaultdict(int))
        totals: Dict[str, int] = defaultdict(int)

        for click in clicks:
            aff = _safe_get(click, "affiliate_id")
            ip = _safe_get(click, "ip_hash")
            if aff is None or not ip:
                continue
            per_affiliate[str(aff)][str(ip)] += 1
            totals[str(aff)] += 1

        flagged: List[Dict[str, Any]] = []
        for aff, ip_counts in per_affiliate.items():
            total = totals[aff]
            if total <= 0:
                continue
            # most common IP for this affiliate
            top_ip, top_count = max(ip_counts.items(), key=lambda kv: kv[1])
            cluster_pct = top_count / total
            if cluster_pct > threshold:
                flagged.append({
                    "affiliate_id": aff,
                    "reason": "ip_clustering",
                    "ip_hash": top_ip,
                    "cluster_pct": round(cluster_pct, 4),
                    "click_count": total,
                })

        flagged.sort(key=lambda r: r["cluster_pct"], reverse=True)
        return flagged

    # --------------------------------------------------------- self referral
    def detect_self_referral(
        self,
        commissions: Sequence[Dict[str, Any]],
    ) -> List[Dict[str, Any]]:
        """Flag commissions where the customer is the affiliate themselves.

        Args:
            commissions: list of {affiliate_id, customer_email, affiliate_email}

        Returns:
            list of {affiliate_id, reason, customer_email, affiliate_email}
        """
        if not commissions:
            return []
        flagged: List[Dict[str, Any]] = []
        for c in commissions:
            customer = _safe_get(c, "customer_email")
            affiliate = _safe_get(c, "affiliate_email")
            aff_id = _safe_get(c, "affiliate_id")
            if _emails_match(customer, affiliate):
                flagged.append({
                    "affiliate_id": aff_id,
                    "reason": "self_referral",
                    "customer_email": customer,
                    "affiliate_email": affiliate,
                })
        return flagged

    # --------------------------------------------------------- refund ratio
    def detect_refund_ratio(
        self,
        commissions: Sequence[Dict[str, Any]],
        threshold: float = DEFAULT_REFUND_THRESHOLD,
    ) -> List[Dict[str, Any]]:
        """Compute per-affiliate refund-to-sale ratio; flag those above threshold.

        A commission is counted as a "refund" if its `status` field (case
        insensitive) contains "refund" or "reversed", or if `is_refund` is truthy.
        Everything else counts as a sale.

        Args:
            commissions: list of {affiliate_id, status?, is_refund?, ...}
            threshold: fraction in [0, 1]; default 0.30.

        Returns:
            list of {affiliate_id, reason, ratio, sales, refunds} sorted by
            ratio desc.
        """
        if not commissions:
            return []
        try:
            threshold = float(threshold)
        except (TypeError, ValueError):
            threshold = DEFAULT_REFUND_THRESHOLD
        if not (0.0 <= threshold <= 1.0):
            threshold = DEFAULT_REFUND_THRESHOLD

        sales: Dict[str, int] = defaultdict(int)
        refunds: Dict[str, int] = defaultdict(int)

        for c in commissions:
            aff = _safe_get(c, "affiliate_id")
            if aff is None:
                continue
            aff = str(aff)
            if self._is_refund(c):
                refunds[aff] += 1
            sales[aff] += 1  # refund still counts as a (attempted) sale event

        flagged: List[Dict[str, Any]] = []
        for aff, sale_count in sales.items():
            refund_count = refunds.get(aff, 0)
            if sale_count <= 0:
                continue
            ratio = refund_count / sale_count
            if ratio > threshold:
                flagged.append({
                    "affiliate_id": aff,
                    "reason": "high_refund_ratio",
                    "ratio": round(ratio, 4),
                    "sales": sale_count,
                    "refunds": refund_count,
                })

        flagged.sort(key=lambda r: r["ratio"], reverse=True)
        return flagged

    @staticmethod
    def _is_refund(commission: Dict[str, Any]) -> bool:
        if _safe_get(commission, "is_refund"):
            return True
        status = _safe_get(commission, "status")
        if not status:
            return False
        s = str(status).strip().lower()
        return "refund" in s or "revers" in s or "chargeback" in s

    # ------------------------------------------------------------- composite
    def score_risk(
        self,
        affiliate_id: str,
        clicks: Sequence[Dict[str, Any]],
        commissions: Sequence[Dict[str, Any]],
        cluster_threshold: float = DEFAULT_CLUSTER_THRESHOLD,
        refund_threshold: float = DEFAULT_REFUND_THRESHOLD,
    ) -> Dict[str, Any]:
        """Composite 0-100 risk score combining all three signals.

        Weighting:
            ip_clustering     40 points (max)
            self_referral     35 points (max)
            high_refund_ratio 25 points (max)

        Returns:
            {affiliate_id, risk_score, level, signals: [...]}
            where level is 'low' (<34), 'medium' (34-66), 'high' (>66).
        """
        aff = str(affiliate_id)
        signals: List[Dict[str, Any]] = []
        score = 0.0

        # IP clustering
        cluster_hits = [c for c in clicks
                        if str(_safe_get(c, "affiliate_id", "")) == aff]
        cluster_flags = self.detect_ip_clustering(cluster_hits, threshold=cluster_threshold)
        if cluster_flags:
            # scale by how far above threshold the worst cluster is
            worst = cluster_flags[0]
            overage = min(1.0, (worst["cluster_pct"] - cluster_threshold)
                         / max(1e-6, 1.0 - cluster_threshold))
            contribution = 40.0 * (0.5 + 0.5 * overage)
            score += contribution
            signals.append({
                "type": "ip_clustering",
                "weight": 40.0,
                "contribution": round(contribution, 2),
                "detail": worst,
            })

        # Self-referral
        aff_commissions = [c for c in commissions
                           if str(_safe_get(c, "affiliate_id", "")) == aff]
        self_ref_flags = self.detect_self_referral(aff_commissions)
        if self_ref_flags:
            # 35 points if any self-referral; scale by share of commissions
            share = len(self_ref_flags) / max(1, len(aff_commissions))
            contribution = 35.0 * share
            score += contribution
            signals.append({
                "type": "self_referral",
                "weight": 35.0,
                "contribution": round(contribution, 2),
                "detail": {"count": len(self_ref_flags),
                           "share": round(share, 4)},
            })

        # Refund ratio
        refund_flags = self.detect_refund_ratio(aff_commissions, threshold=refund_threshold)
        refund_hit = next((r for r in refund_flags if str(r["affiliate_id"]) == aff), None)
        if refund_hit:
            overage = min(1.0, (refund_hit["ratio"] - refund_threshold)
                         / max(1e-6, 1.0 - refund_threshold))
            contribution = 25.0 * (0.5 + 0.5 * overage)
            score += contribution
            signals.append({
                "type": "high_refund_ratio",
                "weight": 25.0,
                "contribution": round(contribution, 2),
                "detail": refund_hit,
            })

        score = round(min(100.0, max(0.0, score)), 2)
        if score > 66.0:
            level = "high"
        elif score > 34.0:
            level = "medium"
        else:
            level = "low"

        return {
            "affiliate_id": aff,
            "risk_score": score,
            "level": level,
            "signals": signals,
        }


# ------------------------------------------------------------------- demo
if __name__ == "__main__":
    import unittest
    loader = unittest.TestLoader()
    suite = loader.discover(start_dir=".", pattern="test_fraud.py")
    runner = unittest.TextTestRunner(verbosity=2)
    runner.run(suite)
