# back-end/kit

The D2L Content Development Kit itself — carried over from the internship prototype, and the thing the Harden & Document epic actually modifies. Not a reference copy: bugs get fixed here, new accessibility rules get added to `harness/lint/rules.js` here, new skill guides go in `skills/` here.

- `skills/` — the 6 skill guides the AI agent follows to pick and build the right D2L avenue (SCORM, content topic, homepage widget, hosted page)
- `harness/` — the lint/QA gate (`lint/rules.js`, 22 rules currently), the SCORM/tenant emulator, and `tenant-profile.json` (what SCSU's Brightspace tenant actually allows)
- `probes/` — the tenant-measurement probes the harness's findings are based on
- `builds/cdk/` — the faculty-facing walkthrough, deployed as six D2L content topics. **Currently describes the old CLI-driven workflow** — needs a rewrite once the front end/back end ships (see its own README and findings #16/#17)
- `docs/CDK_Review_Findings.md` — the existing findings log; this is the actual punch list for the Hardening & Defect Closure epic (E1)
- `docs/TILT_UDL_Reference.docx` — the TILT/UDL pedagogical background (definitions, evidence base, design implications) the automated check (E4) is built against
- `docs/Placement_and_Pedagogy.md`, `docs/Skill_Spectrum_Plan.md`, `docs/Synthetic_Semester_Design.md`, `docs/IT_Proposal_Synthetic_Accounts.md` — design docs behind the validation approach (E8): synthetic-persona testing tiers and where the kit fits pedagogically
- `cors_server.py` — existing dev-server tooling. Needs a look once `back-end/src` has its own local server — may be redundant.
