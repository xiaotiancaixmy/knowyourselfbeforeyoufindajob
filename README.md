# know yourself before you find a job

Single-user Streamlit prototype for candidate onboarding, evidence-gap discovery, dossier generation, and resume rewriting.

## What this prototype does

- Import resume text or PDF
- Parse baseline experiences
- Let the user review and edit baseline records
- Select 2-3 key experiences for deep dive
- Detect evidence gaps and ask targeted follow-up questions
- Generate company dossiers and a candidate profile
- Rewrite a professional summary and experience bullets

## Run locally

1. Create a virtual environment and install dependencies:

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

2. Configure DeepSeek:

```bash
cp .env.example .env
```

3. Start the app:

```bash
streamlit run streamlit_app.py
```

## Notes

- The prototype stores local state in `app.db`.
- If DeepSeek env vars are missing, the app falls back to deterministic heuristics so the workflow still runs.
- The app is intentionally single-user and local-first.

## Project Skills

- Project-scoped agent skills live in `skills/`.
- `skills/resume-ingestion/SKILL.md`
- `skills/experience-normalization/SKILL.md`
- `skills/fact-completion/SKILL.md`
- `skills/hiring-judgment/SKILL.md`
