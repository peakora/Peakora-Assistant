# Copyright (c) 2026 Peakora. All rights reserved. Licensed under the MIT License; see NOTICE and LICENSE.
"""attribution_analytics  -  affiliate performance aggregation and cohort retention.

Provides four reporting methods:

  performance_summary(clicks, commissions)        overall program math.
  top_partners(commissions, limit=10)             affiliates ranked by revenue.
  cohort_retention(commissions, cohort_months=6)  monthly retention curves.
  partner_cohort_report(commissions, affiliate_id) per-partner retention curve.

stdlib-only, no external dependencies.
"""
from __future__ import annotations

import calendar
import datetime as _dt
from collections import defaultdict
from typing import Any, Dict, List, Optional, Sequence, Tuple


# ----------------------------------------------------------------- helpers
def _to_number(value: Any, default: float = 0.0) -> float:
    """Best-effort numeric coercion."""
    if value is None:
        return default
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def _parse_date(value: Any) -> Optional[_dt.datetime]:
    """Parse an ISO 8601 datetime/date or epoch seconds. Returns None on failure."""
    if value is None:
        return None
    if isinstance(value, _dt.datetime):
        return value
    if isinstance(value, _dt.date):
        return _dt.datetime(value.year, value.month, value.day)
    if isinstance(value, (int, float)):
        try:
            return _dt.datetime.fromtimestamp(float(value))
        except (ValueError, OSError, OverflowError):
            return None
    if isinstance(value, str):
        s = value.strip()
        if not s:
            return None
        # try ISO formats (with optional Z / fractional seconds)
        candidate = s.replace("Z", "+00:00")
        try:
            return _dt.datetime.fromisoformat(candidate)
        except ValueError:
            pass
        # try a few common formats
        for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%d", "%Y/%m/%d", "%d/%m/%Y"):
            try:
                return _dt.datetime.strptime(s, fmt)
            except ValueError:
                continue
    return None


def _month_key(dt: Optional[_dt.datetime]) -> Optional[Tuple[int, int]]:
    """Return (year, month) for a datetime, or None."""
    if dt is None:
        return None
    return (dt.year, dt.month)


def _month_label(year: int, month: int) -> str:
    return f"{year:04d}-{month:02d}"


def _add_months(year: int, month: int, n: int) -> Tuple[int, int]:
    """Add n months to (year, month); handles wraparound."""
    idx = (year * 12) + (month - 1) + n
    return (idx // 12, idx % 12 + 1)


def _months_between(start: Tuple[int, int], end: Tuple[int, int]) -> int:
    """Whole months from start (year, month) to end (year, month). 0 if same."""
    return (end[0] - start[0]) * 12 + (end[1] - start[1])


# ---------------------------------------------------------------- main class
class AttributionAnalytics:
    """Aggregate affiliate clicks/commissions into performance reports."""

    # ------------------------------------------------------- summary
    def performance_summary(
        self,
        clicks: Sequence[Dict[str, Any]],
        commissions: Sequence[Dict[str, Any]],
    ) -> Dict[str, Any]:
        """Return overall program math.

        A commission counts as a conversion when it is not a refund
        (status not refund-like and is_refund falsy).
        """
        total_clicks = 0
        active_partners: set = set()
        try:
            for click in clicks or []:
                total_clicks += 1
                aff = click.get("affiliate_id")
                if aff is not None:
                    active_partners.add(str(aff))
        except Exception:
            total_clicks = 0

        total_commission = 0.0
        total_conversions = 0
        try:
            for c in commissions or []:
                aff = c.get("affiliate_id")
                if aff is not None:
                    active_partners.add(str(aff))
                if _is_refund(c):
                    continue
                total_conversions += 1
                total_commission += _to_number(c.get("commission_amount"))
        except Exception:
            pass

        conversion_rate = (total_conversions / total_clicks) if total_clicks > 0 else 0.0
        avg_commission = (total_commission / total_conversions) if total_conversions > 0 else 0.0

        return {
            "total_clicks": total_clicks,
            "total_conversions": total_conversions,
            "conversion_rate": round(conversion_rate, 4),
            "total_commission": round(total_commission, 2),
            "avg_commission": round(avg_commission, 2),
            "active_partners": len(active_partners),
        }

    # ------------------------------------------------------- top partners
    def top_partners(
        self,
        commissions: Sequence[Dict[str, Any]],
        limit: int = 10,
    ) -> List[Dict[str, Any]]:
        """Rank affiliates by total (non-refund) commission_amount, desc."""
        totals: Dict[str, float] = defaultdict(float)
        counts: Dict[str, int] = defaultdict(int)

        for c in commissions or []:
            if _is_refund(c):
                continue
            aff = c.get("affiliate_id")
            if aff is None:
                continue
            aff = str(aff)
            totals[aff] += _to_number(c.get("commission_amount"))
            counts[aff] += 1

        ranked = sorted(totals.items(), key=lambda kv: kv[1], reverse=True)
        limit = max(0, int(limit))
        result: List[Dict[str, Any]] = []
        for aff, total in ranked[:limit]:
            conv = counts[aff]
            result.append({
                "affiliate_id": aff,
                "total_commission": round(total, 2),
                "conversions": conv,
                "avg_commission": round(total / conv, 2) if conv else 0.0,
            })
        return result

    # ------------------------------------------------------- cohort retention
    def cohort_retention(
        self,
        commissions: Sequence[Dict[str, Any]],
        cohort_months: int = 6,
    ) -> List[Dict[str, Any]]:
        """Group commissions by customer signup month (derived from
        `created_at`) and compute month-by-month retention.

        For each cohort (signup month), `retention_by_month` maps month-offset
        N (1 = signup month, 2 = next month, ...) to the % of the cohort that
        had at least one commission in that month.
        """
        try:
            cohort_months = int(cohort_months)
        except (TypeError, ValueError):
            cohort_months = 6
        if cohort_months <= 0:
            cohort_months = 6

        # First pass: determine each customer's signup month = the month of
        # their earliest (non-refund) commission. We then bucket every later
        # commission for that customer into the same cohort.
        customer_signups: Dict[Any, Tuple[int, int]] = {}
        # (cohort_key) -> set of customer ids (cohort size)
        cohorts: Dict[Tuple[int, int], set] = defaultdict(set)
        # cohorts[signup_month][month_offset] = set of customers active that month
        activity: Dict[Tuple[int, int], Dict[int, set]] = defaultdict(lambda: defaultdict(set))

        # gather all non-refund commissions with a parseable date
        events: List[Dict[str, Any]] = []
        for c in commissions or []:
            if _is_refund(c):
                continue
            dt = _parse_date(c.get("created_at") or c.get("signup_at"))
            if dt is None:
                continue
            customer = c.get("customer_id") or c.get("customer_email") or id(c)
            events.append((dt, customer, c))

        # determine each customer's earliest month as their cohort signup
        for dt, customer, _ in events:
            mk = _month_key(dt)
            if mk is None:
                continue
            existing = customer_signups.get(customer)
            if existing is None or mk < existing:
                customer_signups[customer] = mk

        # second pass: bucket activity by cohort + month offset
        for dt, customer, c in events:
            signup = customer_signups.get(customer)
            if signup is None:
                continue
            cohorts[signup].add(customer)
            mk = _month_key(dt)
            if mk is None:
                continue
            offset = _months_between(signup, mk)
            if offset < 0:
                offset = 0
            activity[signup][offset + 1].add(customer)

        result: List[Dict[str, Any]] = []
        for cohort_key in sorted(cohorts.keys()):
            size = len(cohorts[cohort_key])
            if size == 0:
                continue
            retention: Dict[int, float] = {}
            for n in range(1, cohort_months + 1):
                active_n = len(activity[cohort_key].get(n, set()))
                retention[n] = round(active_n / size, 4)
            result.append({
                "cohort_month": _month_label(*cohort_key),
                "size": size,
                "retention_by_month": retention,
            })
        return result

    # -------------------------------------------------- partner cohort report
    def partner_cohort_report(
        self,
        commissions: Sequence[Dict[str, Any]],
        affiliate_id: str,
    ) -> List[Dict[str, Any]]:
        """Per-partner version of cohort retention: restrict to one
        affiliate's commissions and compute that partner's signup cohorts."""
        try:
            aff = str(affiliate_id)
        except Exception:
            return []
        scoped = [c for c in commissions or []
                  if str(c.get("affiliate_id", "")) == aff]
        # reuse the global logic but tag rows with the affiliate_id for clarity.
        rows = self.cohort_retention(scoped, cohort_months=6)
        for row in rows:
            row["affiliate_id"] = aff
        return rows


# ----------------------------------------------------------------- helpers
def _is_refund(commission: Dict[str, Any]) -> bool:
    """A commission counts as a refund if is_refund truthy or status is
    refund/reversed/chargeback."""
    try:
        if commission.get("is_refund"):
            return True
        status = commission.get("status")
        if not status:
            return False
        s = str(status).strip().lower()
        return "refund" in s or "revers" in s or "chargeback" in s
    except Exception:
        return False


# ------------------------------------------------------------------- demo
if __name__ == "__main__":
    import unittest
    loader = unittest.TestLoader()
    suite = loader.discover(start_dir=".", pattern="test_analytics.py")
    runner = unittest.TextTestRunner(verbosity=2)
    runner.run(suite)
