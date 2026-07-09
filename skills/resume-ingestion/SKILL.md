---
name: resume-ingestion
description: Use when implementing onboarding entry flows that turn resume inputs such as PDF uploads, pasted text, or manual background answers into cleaned and minimally structured experience blocks for downstream candidate analysis.
---

# Resume Ingestion

## Overview

`resume-ingestion` is the entry skill for onboarding input pipelines. It is not just PDF parsing. Its job is to turn messy resume sources into a cleaned, quality-checked, minimally structured baseline that downstream analysis can safely consume.

## When to Use

Use when implementing any of these:

- resume upload intake
- pasted text intake
- manual fallback intake when no resume exists
- baseline shaping before `baseline review` or deeper candidate analysis

Do not use this skill for later-stage judgment, rewriting, dossier generation, or interview prep.

## Core Architecture

Keep these responsibilities separate:

- `source intake`
  Accept `pdf`, `text`, or guided manual answers.
- `extractor`
  Pull raw text from the source. PDF extraction is only one extractor.
- `cleaner`
  Normalize whitespace, remove repeated blank lines, preserve meaningful line boundaries.
- `quality gate`
  Decide whether the extracted text is usable for onboarding.
- `fallback handler`
  If quality is poor, switch input mode or ask for more source material. Do not pretend extraction succeeded.
- `baseline shaper`
  Split usable text into initial `experience blocks`.
- `handoff`
  Pass cleaned text and minimally structured experience data to the next step.

## Processing Order

Always process in this order:

`accept source -> extract -> clean -> assess quality -> fallback if needed -> shape baseline -> hand off`

Do not skip the quality gate. A parser that returns text is not the same thing as onboarding being ready.

## Quality Rules

Block or fallback when:

- PDF extraction returns empty or near-empty text
- extracted text is mostly noise, layout fragments, or headers
- content is too thin to form even one usable experience block
- manual answers are too vague to identify company, role, timeframe, or work context

If input quality is weak, fix the input first. Do not push the mess downstream.

## Baseline Shaping

The output should not stop at raw text. Shape it into editable experience blocks with at least:

- `company`
- `role`
- `timeframe`
- `business_context`
- `projects`
- `responsibilities`
- `outcomes`

This structure can be incomplete, but it must be coherent enough for a human to review and edit.

## Output Contract

The handoff from ingestion must produce:

- cleaned source text
- source metadata such as `pdf` or `text`
- minimally structured `experience blocks`
- an explicit readiness state for baseline review

Downstream stages should not need to guess whether ingestion worked.

## Common Mistakes

- Treating PDF extraction as the whole problem
- Mixing extraction, parsing, and judgment into one large function
- Letting poor raw text leak into later stages
- Only handling happy-path resumes with perfect formatting
- Returning raw text without a shaped baseline
