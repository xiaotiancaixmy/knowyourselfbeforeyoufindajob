---
name: experience-normalization
description: Use when implementing logic that turns cleaned resume source text or freeform candidate answers into stable, minimally editable experience records with consistent field boundaries for downstream review and analysis.
---

# Experience Normalization

## Overview

`experience-normalization` turns cleaned candidate source material into stable `experience records`. Its purpose is not deep evaluation. Its job is to produce consistent structural boundaries so later steps can review, edit, score, and enrich the experience safely.

## When to Use

Use when implementing any of these:

- resume-to-experience parsing
- manual answer merging into existing experience records
- baseline record shaping before review
- normalization logic that sits between ingestion and deeper analysis

Do not use this skill for hiring judgment, rewrite quality, or follow-up dialogue design.

## Core Architecture

Keep these responsibilities separate:

- `record splitter`
  Detect where one experience ends and another begins.
- `field extractor`
  Pull `company`, `role`, `timeframe`, and first-pass supporting fields.
- `normalizer`
  Convert messy text into stable list fields such as `projects`, `responsibilities`, and `outcomes`.
- `fallback parser`
  Use heuristic parsing when model parsing fails.
- `answer merger`
  Merge later candidate answers into the correct experience without wiping prior structure.
- `record validator`
  Reject records that are too incomplete to review.

## Normalization Rules

Each normalized experience should aim to produce:

- `company`
- `role`
- `timeframe`
- `business_context`
- `projects`
- `responsibilities`
- `outcomes`
- `evidence_notes`

Not every field must be rich on first pass, but empty structure is better than hidden ambiguity. Preserve partial truth instead of inventing polish.

## Merge Rules

When merging later answers into an existing record:

- append new evidence instead of overwriting prior notes
- promote concrete candidate statements into `responsibilities` or `outcomes` only when the signal is explicit
- avoid duplicating near-identical lines
- keep the merge operation local to the selected experience

Normalization should make later review easier, not hide uncertainty.

## Output Contract

The handoff from normalization must produce:

- a stable list of `experience records`
- predictable field names and field types
- enough structure for `baseline review`
- enough continuity that later fact completion can safely merge new details

Downstream modules should not need to re-interpret raw source text from scratch.

## Common Mistakes

- Mixing parsing and hiring judgment in the same step
- Overfitting to one resume layout
- Dropping partial records because they are messy
- Letting merge logic overwrite previously reviewed structure
- Treating heuristic fallback as a bug instead of a required path
