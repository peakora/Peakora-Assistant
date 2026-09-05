# Copyright (c) 2026 Peakora. All rights reserved. Licensed under the MIT License; see NOTICE and LICENSE.
"""affiliate_partner_discovery  -  SaaS-niche affiliate partner discovery and outreach.

This module discovers potential affiliate partners for a SaaS product, evaluates
them with a transparent, offline scoring framework (no paid traffic/SEO API
needed), ranks candidates by a composite score, and drafts a personalized
3-touch outreach email sequence (day 0, day 3, day 7).

stdlib-only, no external dependencies.
"""
from __future__ import annotations

import re
from typing import Any, Dict, List, Optional, Sequence, Tuple


def _clamp(value: float, low: float = 0.0, high: float = 1.0) -> float:
    """Clamp a float into [low, high]."""
    if value is None:
        return low
    try:
        v = float(value)
    except (TypeError, ValueError):
        return low
    if v < low:
        return low
    if v > high:
        return high
    return v


def _audience_to_traffic_score(audience_size: float) -> float:
    """Map an absolute audience size (subscribers/visitors) to a 0-1 traffic score.

    Uses a log curve so growth has diminishing returns: 0 -> 0.0, ~1k -> 0.50,
    ~10k -> 0.75, ~100k -> 0.90, ~1M+ -> ~0.97. Anything unparseable -> 0.0.
    """
    try:
        a = float(audience_size)
    except (TypeError, ValueError):
        return 0.0
    if a <= 0:
        return 0.0
    import math
    # log10(audience) + 1 capped at 6, normalized to 0..1.
    score = (math.log10(a + 1.0)) / 6.0
    return _clamp(score)


class PartnerDiscovery:
    """Discover, score, and draft outreach for SaaS-niche affiliate partners."""

    def __init__(self, candidates: Optional[List[Dict[str, Any]]] = None) -> None:
        # In-memory candidate pool. Allows callers to seed once and run multiple
        # niche queries against it.
        self._candidates: List[Dict[str, Any]] = list(candidates or [])

    # ------------------------------------------------------------------ pool
    def add_candidates(self, candidates: Sequence[Dict[str, Any]]) -> None:
        """Append candidate dicts to the internal pool."""
        for c in candidates:
            self._candidates.append(self._normalize_candidate(c))

    @staticmethod
    def _normalize_candidate(candidate: Dict[str, Any]) -> Dict[str, Any]:
        """Return a copy of candidate with defaulted/typed fields."""
        c = dict(candidate)
        c.setdefault("name", "Unknown partner")
        c.setdefault("url", "")
        c.setdefault("platform", "unknown")
        c.setdefault("audience_size", 0)
        c["niche_fit_score"] = _clamp(c.get("niche_fit_score", 0.0))
        c.setdefault("niche", "")
        return c

    def from_search_hints(self, hints: Sequence[Tuple[str, str]], niche: str = "") -> List[Dict[str, Any]]:
        """Build candidate dicts from minimal (name, url) hint tuples.

        Niche fit is heuristically seeded by substring-matching the niche keyword
        against the url/name. Callers can refine `niche_fit_score` later.
        """
        built: List[Dict[str, Any]] = []
        keyword = (niche or "").strip().lower()
        # split into tokens so "developer-tools" yields ["developer", "tools"],
        # any token hit counts as a niche match.
        tokens = [t for t in re.split(r"[\s\-_,]+", keyword) if t]
        for hint in hints:
            name, url = hint[0], hint[1] if len(hint) > 1 else ""
            haystack = f"{name} {url}".lower()
            fit = 0.6 if tokens and any(t in haystack for t in tokens) else (
                0.4 if tokens else 0.5
            )
            built.append({
                "name": name,
                "url": url,
                "platform": _infer_platform(url),
                "audience_size": 0,
                "niche_fit_score": fit,
                "niche": niche,
            })
        self.add_candidates(built)
        return built

    # ------------------------------------------------------------- discovery
    def discover_niche_partners(self, niche: str, max_results: int = 20) -> List[Dict[str, Any]]:
        """Return ranked candidate partners for the given niche.

        Filters the candidate pool to the niche (case-insensitive substring
        match on the `niche` field, or un-scored candidates when the pool has no
        niche set), evaluates each, sorts by composite score desc, and trims to
        `max_results`.
        """
        keyword = (niche or "").strip().lower()
        if keyword:
            pool = [c for c in self._candidates
                    if (c.get("niche") or "").strip().lower() == keyword
                    or not c.get("niche")]
        else:
            pool = list(self._candidates)

        scored: List[Dict[str, Any]] = []
        for c in pool:
            evaluated = self.evaluate_partner(c)
            scored.append({**c, "evaluation": evaluated})

        scored.sort(key=lambda row: row["evaluation"]["score"], reverse=True)
        return scored[:max(0, int(max_results))]

    # -------------------------------------------------------------- scoring
    def evaluate_partner(self, candidate: Dict[str, Any]) -> Dict[str, Any]:
        """Evaluate a single candidate and return a scoring breakdown.

        Returns:
            traffic_score       0..1  (audience_size + niche-fit blended)
            relevance_score     0..1  (niche_fit_score, primary signal)
            outreach_priority   'high' | 'medium' | 'low'
            score               0..100 composite

        Niche-fit weighting: relevance dominates the composite (70%) because a
        perfectly-aligned small audience beats a generic huge one for
        conversion; traffic contributes the remaining 30%.
        """
        try:
            c = self._normalize_candidate(candidate)
            niche_fit = _clamp(c.get("niche_fit_score", 0.0))
            traffic = _audience_to_traffic_score(c.get("audience_size", 0))

            # Blend: a high-fit tiny audience still gets meaningful traffic_score.
            blended_traffic = _clamp(0.6 * traffic + 0.4 * niche_fit)
            relevance = niche_fit

            composite = _clamp(0.70 * relevance + 0.30 * blended_traffic)
            score = round(composite * 100.0, 2)

            if score >= 70.0:
                priority = "high"
            elif score >= 40.0:
                priority = "medium"
            else:
                priority = "low"

            return {
                "traffic_score": round(blended_traffic, 4),
                "relevance_score": round(relevance, 4),
                "outreach_priority": priority,
                "score": score,
            }
        except Exception as exc:  # never raise from evaluation
            return {
                "traffic_score": 0.0,
                "relevance_score": 0.0,
                "outreach_priority": "low",
                "score": 0.0,
                "error": str(exc),
            }

    # -------------------------------------------------------------- outreach
    def draft_outreach_sequence(
        self,
        candidate: Dict[str, Any],
        program_terms: Dict[str, Any],
        tone: str = "warm",
    ) -> List[str]:
        """Draft a 3-touch outreach sequence (day 0, day 3, day 7).

        `program_terms` should include commission rate, cookie window, and
        payout methods. Plain-text, professional, no emoji.
        """
        try:
            c = self._normalize_candidate(candidate)
            terms = program_terms or {}
            name = c.get("name") or "there"
            niche = c.get("niche") or "your space"
            commission = terms.get("commission_rate", "the standard rate")
            cookie = terms.get("cookie_window", "the standard cookie window")
            payouts = terms.get("payout_methods", "our supported payout methods")
            if isinstance(payouts, (list, tuple)):
                payouts = ", ".join(str(p) for p in payouts)
            greeting_adj = self._tone_greeting(tone)

            email_0 = (
                f"Subject: A partnership idea for {name}\n\n"
                f"Hi {name},\n\n"
                f"{greeting_adj} I am Ala, and I run the affiliate program for "
                f"Peakora, a SaaS product serving the {niche} community. I came "
                f"across your work and think your audience would genuinely "
                f"benefit from what we have built.\n\n"
                f"We offer {commission} recurring commission with a {cookie} "
                f"tracking window, paid out via {payouts}. I would love to share "
                f"more detail and answer any questions. Are you open to a short "
                f"note next week?\n\n"
                f"Best regards,\n"
                f"Ala\n"
            )

            email_3 = (
                f"Subject: Following up  -  partnership with Peakora\n\n"
                f"Hi {name},\n\n"
                f"Following up on my note from a few days ago. I know inboxes get "
                f"busy, so I will keep this brief.\n\n"
                f"In short: if your audience in the {niche} space ever evaluates "
                f"tools like ours, you would earn {commission} per active "
                f"referral, tracked for {cookie}. Payouts go out through "
                f"{payouts}.\n\n"
                f"Happy to send a demo link or a one-pager. Just reply with "
                f"\"send details\" and I will get it over.\n\n"
                f"Best,\n"
                f"Ala\n"
            )

            email_7 = (
                f"Subject: Last note  -  Peakora partnership\n\n"
                f"Hi {name},\n\n"
                f"This will be my last message on this so I do not clutter your "
                f"inbox.\n\n"
                f"If the timing is not right for the {niche} audience, no worries "
                f"at all  -  just let me know and I will close the loop. If you are "
                f"interested, the quickest path is a 15-minute call where I can "
                f"walk through {commission} commission, the {cookie} cookie, and "
                f"how {payouts} payouts work.\n\n"
                f"Either way, thank you for the work you do in the {niche} "
                f"community.\n\n"
                f"Best regards,\n"
                f"Ala\n"
            )

            return [email_0, email_3, email_7]
        except Exception as exc:
            return [
                f"Subject: Outreach error\n\nCould not draft outreach: {exc}\n"
            ]

    @staticmethod
    def _tone_greeting(tone: str) -> str:
        t = (tone or "warm").strip().lower()
        if t == "formal":
            return "I hope this message finds you well."
        if t == "casual":
            return "Hope you are having a good week."
        # default warm
        return "I hope you are having a good week."


# ----------------------------------------------------------------- helpers
_PLATFORM_PATTERNS = [
    (re.compile(r"youtube\.com|youtu\.be", re.I), "youtube"),
    (re.compile(r"twitter\.com|x\.com", re.I), "twitter"),
    (re.compile(r"linkedin\.com", re.I), "linkedin"),
    (re.compile(r"instagram\.com", re.I), "instagram"),
    (re.compile(r"tiktok\.com", re.I), "tiktok"),
    (re.compile(r"twitch\.tv", re.I), "twitch"),
    (re.compile(r"github\.com", re.I), "github"),
    (re.compile(r"medium\.com", re.I), "blog"),
]


def _infer_platform(url: str) -> str:
    """Infer the publishing platform from a URL."""
    if not url:
        return "website"
    for pattern, platform in _PLATFORM_PATTERNS:
        if pattern.search(url):
            return platform
    return "website"


# ------------------------------------------------------------------- demo
if __name__ == "__main__":
    import unittest
    loader = unittest.TestLoader()
    suite = loader.discover(start_dir=".", pattern="test_discovery.py")
    runner = unittest.TextTestRunner(verbosity=2)
    runner.run(suite)
