---
name: affiliate_partner_discovery
description: "affiliate_partner_discovery - SaaS-niche affiliate partner discovery + outreach"
allowed-tools: Read
metadata:
  version: 1.0.0
---

# affiliate_partner_discovery  -  SaaS-niche affiliate partner discovery + outreach

## When to use
Use when Ala needs to grow the Peakora affiliate program by finding new
SaaS-niche partners. This skill takes candidate partner hints (name + URL),
scores them against an audience/niche-fit framework (no paid SEO/traffic API
required), ranks by composite score, and drafts a 3-touch personalized outreach
email sequence (day 0 / day 3 / day 7) tailored to each candidate's niche and
the program's commission terms.

Typical flow:
1. `from_search_hints([(name, url), ...])` builds candidate dicts.
2. `discover_niche_partners(niche)` ranks candidates by `evaluate_partner`.
3. `draft_outreach_sequence(candidate, program_terms)` returns the 3 emails.

## Env
No environment variables required. The skill is stdlib-only and offline; it
does not call any paid traffic/API service. All inputs are passed as Python
arguments. If you later wire a real traffic API, inject candidate dicts that
already carry `audience_size` and `niche_fit_score`.

## Owner
Maintained for Ala.
