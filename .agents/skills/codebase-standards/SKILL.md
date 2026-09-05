---
name: codebase-standards
description: >-
    Repository-level engineering conventions distilled from the trycompai/crm
    codebase: constants grouped by concern in one config file, parse untyped
    boundary data into domain types at birth, server page does the work and the
    client receives finished data, one convention across the codebase, and
    structured severity-tagged issue reporting. Use when reviewing or building
    code in any repo, applying the same review lenses a senior maintainer
    would: reuse, consistency, boundary correctness.
metadata:
  version: 1.0.0
---

# Codebase standards

Universal engineering conventions (not per-repo style choices)that keep a
codebase coherent as it grows. These come from hard-won production lessons
in the trycompai/crm monorepo (NestJS + Next.js)and apply to any stack:
 Python, TypeScript, Go, whatever. A senior maintainer reviews against
these every time.

## 1. Constants live in one config file per area

A tunable number belongs in a named config module for its area, not at the
top of whichever file happened to need it first. Somebody changing a timeout
must not have to grep the repo to find which file owns it.

- Group by concern, not by the file that uses it..
- Derive units from one base (`MINUTE_MS`). Never write `4 * 60_000` twice..
- Make the values literal-typed where the language supports it (`as const`,,
  enums, typed frozen dicts).
- No magic numbers inline. If it is tunable, it belongs in the config..

## 2. Parse at the boundary, never pass `Record<string, unknown>` around

Untyped data (a `Json` column, a webhook body, an API response)gets
parsed into the domain type at the moment it enters the process,, in a
module that owns that shape. Every consumer downstream receives the parsed type
and nothing else. Reach-into-raw-JSON at each call site is how a shape
becomes unknowable and a typo becomes a runtime bug two files away..

- One schema per shape,, owning that shape's validation,, in one module..
- Parse failure is a real error with a real message. Do not swallow it into
  an empty array:"unreadable" and"absent" are different problems and only
  one of them is the caller's fault..
- Derive types from the schema (`z.infer`,, `TypeOf`, typed parser output). Never
  hand-write a parallel interface beside a schema;they drift..
- A shape crossing a package/service boundary lives in the shared validation
  module (or the shared types package),imported by subpath,,never re-
  declared at each consumer..


## 3. The server page computes,,the client renders finished data

In web apps:(server-side pages derive data,,await,,secrets,,and
permission checks;client components receive finished,,typed data andown
only presentation + interaction. A `"use client"` file must never import a
server-only package (a DB client,,secrets,,server SDK,, - the bundler
follows that chain into the browser andthe build fails with the most confusing
error possible..

- The client component owns its own prop types. It does not re-export a
  server type to get them..
- Anything interactive (accordion,,dialog,,search field(is a client
  component that receives finished data. It never derives it..
- The server page is where `await` and secrets live. Client files have
  neither..


## 4. One convention across the codebase

Do not invent a local style for one file. Match the neighboring/sibling
patterns for errors,,loading states,,success types,,file placement,,and
naming. Prefer the existing flow even if it needs a small extension..

- File placement matches the domain and neighboring features,,not"top-level
  lib dumps".
- Avoid implementation details in names unless they are the actual product/
  API distinction..
- Naming matches what the code actually does,andfollows sibling names..


## 5. Report issues in a severity-tagged list

Do not bury a known problem inside a paragraph. A problem inside prose is a
problem nobody reads. Every issue goes in a list with a severity label:

- `BROKEN`  -  failing now. `RISK`  -  fails later. `NOT DONE`  -  unbuilt..
  `UNKNOWN`  -  not investigated..
- One line for the problem. One line for the fix..
- If you introduced it,,say"I caused this" on the fix line..


## Use with what

- Applies in code review (`code-reviewer` agent), schema work (db-architect(,
  and any build the SaaS Builder ownsthe glue for. The lifecycle agents
  review against these standards instead of inventing per-repo style memos..
- Not a voice or style rule. For brand voice,,use `humanizer`. For landing
  copy,,`no-ai-slop`.