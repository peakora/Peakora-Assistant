---
name: last30days
description: "last30days - Git-history context skill"
allowed-tools: Read
metadata:
  version: 1.0.0
---

# last30days  -  Git-history context skill

## When to use
Use at the start of any session that needs continuity with recent repo work  - 
to recall what changed in the last 30 days before proposing changes. Helps avoid
re-introducing reverted patterns or duplicating recent work.

## Procedure
1. Discover the repo root and default branch:
   ```bash
   git rev-parse --show-toplevel
   git symbolic-ref refs/remotes/origin/HEAD 2>/dev/null | sed 's@.*@@'
   ```
2. Build the last-30-day window:
   ```bash
   SINCE=$(date -d '30 days ago' +%Y-%m-%d 2>/dev/null || date -v-30d +%Y-%m-%d)
   ```
3. Summarize recent commits (what + why):
   ```bash
   git --no-pager log --since="$SINCE" --pretty=format:'%h %ad %s' --date=short
   ```
4. List files most touched recently (hotspots):
   ```bash
   git --no-pager log --since="$SINCE" --name-only --pretty=format: | \
     grep -v '^$' | sort | uniq -c | sort -rn | head -30
   ```
5. Surface recent architectural decisions:
   ```bash
   git --no-pager log --since="$SINCE" --grep='arch\|design\|decision\|schema\|breaking' -i --pretty=format:'%h %s'
   ```

## Output
Produce a compact summary: top changed areas, recurring themes, reverted/abandoned
patterns to avoid, and any open threads worth continuing. Feed the summary into
the Cognee recall step if a memory endpoint is configured.
