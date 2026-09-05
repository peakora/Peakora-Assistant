---
name: affiliate_fraud_detector
description: "affiliate_fraud_detector - Affiliate program anomaly detection"
allowed-tools: Read
metadata:
  version: 1.0.0
---

# affiliate_fraud_detector  -  Affiliate program anomaly detection

## When to use
Use when Ala suspects abusive or fraudulent affiliate activity: cookie-stuffing
bots, self-referral (affiliate posing as a customer), or refund-spam to extract
commissions on cancelled orders. This skill computes per-affiliate signals and
a composite risk score so a human reviewer can prioritize which accounts to audit
first.

Signals implemented:
- IP clustering  -  flags affiliates where >40% of clicks share one IP hash
  (cookie-stuffing / bot traffic signal).
- Self-referral  -  flags commissions where the customer email equals the
  affiliate's own email.
- Refund ratio  -  flags affiliates whose refund-to-sale ratio exceeds a
  configurable threshold (default 0.3).

## Env
No environment variables required. stdlib-only and offline; all data is passed
as Python lists of dicts. Expected dict shapes are documented on each method.

## Owner
Maintained for Ala.
