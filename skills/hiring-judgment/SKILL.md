---
name: hiring-judgment
description: Use when implementing recruiter-style evaluation logic that turns structured candidate experience records into conservative, evidence-bound assessments, positioning guidance, and claim boundaries.
---

# Hiring Judgment

## Overview

`hiring-judgment` is the evaluation layer that sits after baseline shaping and fact completion. Its job is to judge what the candidate can credibly claim, what should stay conservative, and how to position the candidate without flattering unsupported stories.

## When to Use

Use when implementing any of these:

- recruiter-style experience evaluation
- claim-boundary logic
- conservative positioning recommendations
- dossier, profile, or downstream judgment layers that depend on evidence strength

Do not use this skill for source extraction, raw normalization, or candidate recall flow design.

## Core Architecture

Keep these responsibilities separate:

- `strength extractor`
  Identify what evidence actually supports.
- `risk detector`
  Translate unresolved gaps into concrete recruiting risk.
- `claim boundary`
  Define what must not be overstated.
- `conservative framing`
  Reframe promising-but-thin experiences without fake confidence.
- `positioning evaluator`
  Infer the strongest lane from actual evidence, not aspiration alone.

## Judgment Rules

Always judge in this order:

`what is supported -> what is risky -> what must not be claimed -> what is the conservative framing -> what lane is strongest`

Do not start from the candidate's desired positioning and reverse-engineer evidence to fit it.

## Claim Rules

Use explicit claim boundaries when:

- results are weak or missing
- ownership is unclear
- the candidate sounds broader than the evidence
- the story depends on team output that cannot yet be attributed

The goal is credible hiring material, not encouragement-by-default.

## Positioning Rules

Positioning should:

- follow the strongest repeated evidence themes
- distinguish main lane from transferable capability
- prefer conservative target strategy when evidence is mixed
- refuse false precision when signals are weak

If the strongest lane and desired lane differ, preserve the stronger evidence line first.

## Output Contract

The handoff from hiring judgment must produce:

- supported strengths
- current recruiting risk
- do-not-claim boundaries
- conservative framing guidance
- recommended main lane
- conservative target strategy

Downstream rewriting should inherit these constraints instead of inventing a cleaner story.

## Common Mistakes

- Confusing encouragement with evaluation
- Letting the candidate's aspiration override evidence
- Treating all gaps as style problems instead of hiring risk
- Writing flattering summaries before claim boundaries are defined
- Using judgment outputs without preserving the do-not-claim layer
