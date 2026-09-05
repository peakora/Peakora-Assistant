---
name: attribution_analytics
description: "attribution_analytics - affiliate performance aggregation + cohort retention"
allowed-tools: Read
metadata:
  version: 1.0.0
---

# attribution_analytics  -  affiliate performance aggregation + cohort retention

## When to use
Use when Ala needs to report on affiliate-program performance: total clicks,
conversions, conversion rate, commission totals, top-performing partners ranked
by revenue, and month-by-month cohort retention (what fraction of a signup
cohort still earned commission N months later). All aggregations run on plain
Python lists of click/commission dicts, so they slot into any reporting script
or dashboard backend.

## Env
No environment variables required. stdlib-only and offline; all data is passed
as Python lists of dicts. Expected dict shapes are documented on each method.

## Owner
Maintained for Ala.
