---
name: fact-completion
description: Use when implementing guided candidate follow-up flows that turn thin or partially supported experience records into better-evidenced stories through staged questioning, reflection, and gap filling.
---

# Fact Completion

## Overview

`fact-completion` is the enrichment stage between baseline review and hiring judgment. Its job is to turn partially supported experience records into better-evidenced material without dropping the user into instant interview pressure.

## When to Use

Use when implementing any of these:

- evidence-gap follow-up flows
- candidate recall and reflection loops
- guided experience enrichment before dossier generation
- chat-like onboarding steps that deepen one selected experience at a time

Do not use this skill for initial resume intake, raw parsing, or final rewrite output.

## Core Architecture

Keep these responsibilities separate:

- `gap detector`
  Identify weak evidence areas such as result, ownership, scope, decision, tradeoff, failure, and influence.
- `conversation seeder`
  Start with a warm recall prompt instead of direct interrogation.
- `reflection layer`
  Summarize what the candidate has already revealed before asking the next question.
- `question ladder`
  Move from low-pressure recall to sharper evidence questions in stages.
- `scaffold layer`
  Offer sentence stems when the candidate is vague or stuck.
- `readiness gate`
  Decide when the experience has enough evidence to move downstream.

## Conversation Order

Always work in this order:

`warm recall -> reflect back -> ask one lighter follow-up -> scaffold if needed -> reveal remaining gap -> repeat`

Do not start with `why not another方案` or failure-first questioning. The first job is recall, not pressure.

## Question Design Rules

Questions should:

- begin with scene reconstruction
- ask one thing at a time
- reveal hiring language only after content exists
- prefer progressive ladders over direct high-pressure probes

The candidate should feel guided into memory reconstruction, not dropped into mock interview mode.

## Evidence Rules

Fact completion must explicitly improve at least some of these areas:

- `result`
- `ownership`
- `scope`
- `decision`
- `tradeoff`
- `failure`
- `influence`

If a gap cannot be supported, stop short of overclaiming. Do not convert thin evidence into inflated storytelling.

## Output Contract

The handoff from fact completion must produce:

- updated `experience records`
- accumulated `evidence_notes`
- refreshed `evidence_gaps`
- an explicit readiness signal for downstream dossier or profile generation

Downstream stages should be able to trust that the core candidate claims have already been pressure-checked.

## Common Mistakes

- Starting with aggressive interview-style prompts
- Asking multiple hard questions at once
- Repeating the same gap in multiple UI areas before the user has answered
- Using gap labels without translating them into natural language
- Marking a record ready before high-risk evidence has been clarified
