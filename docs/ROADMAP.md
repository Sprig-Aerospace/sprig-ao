# Sprig AO Roadmap

Triage of the 27 open roadmap issues (#2–#28) into six themed milestones.
Order reflects dependencies: each milestone leans on capabilities introduced
in the prior ones.

| Milestone | Theme | Issues | Count |
|-----------|-------|--------|-------|
| **M1** | Workspace Foundation | #2, #3, #4, #5 | 4 |
| **M2** | Multi-Repo Work Packages | #6, #7, #8, #9 | 4 |
| **M3** | Contract Scanning | #10, #11, #12, #13 | 4 |
| **M4** | Runtime Topology & Profiles | #14, #15, #16, #17, #18 | 5 |
| **M5** | Evidence & Validation | #19, #20, #21, #22, #23 | 5 |
| **M6** | Triage & Operations | #24, #25, #26, #27, #28 | 5 |

Total: 27 issues.

---

## M1 — Workspace Foundation

Model the Sprig multi-repo workspace and teach the agent which repo it
owns. Prerequisite for every later milestone — work packages, contract
scanners, and runtime profiles all reference the workspace manifest.

- **#2** `feat(core): add workspace manifest model for multi-repo ecosystems`
- **#3** `docs/config: create initial sprig workspace manifest`
- **#4** `feat(agent): inject repo ownership guardrails into worker prompts`
- **#5** `feat(web): add workspace repo relationship view`

**Exit criteria**: workspace manifest loads via core, agent prompts include
repo-ownership rules, dashboard shows repo relationships.

---

## M2 — Multi-Repo Work Packages

Coordinate sessions that span more than one repo: bundle linked work,
track inter-session blockers, surface bundle status in the dashboard.
Depends on M1's workspace manifest.

- **#6** `feat(core): add work package model for multi-repo tasks`
- **#7** `feat(cli): add spawn-bundle command for linked multi-repo work`
- **#8** `feat(web): show bundle-linked sessions and PRs`
- **#9** `feat(core): support inter-session blockers within a work package`

**Exit criteria**: `ao spawn-bundle` launches linked sessions across repos,
dashboard renders bundles, blockers propagate between sessions in a bundle.

---

## M3 — Contract Scanning

Detect when runtime/config contracts drift across related repos. Builds
on M1 (workspace manifest tells the scanner which repos to scan) and is
consumed later by M5 (validation) and M6 (triage).

- **#10** `feat(core): add contract scanner framework for repo runtime/config contracts`
- **#11** `feat(core): add initial contract scanners for Sprig repos`
- **#12** `feat(core): detect contract drift across related repos`
- **#13** `feat(cli): add contract scan and diff commands`

**Exit criteria**: `ao contract scan` and `ao contract diff` report drift
across the workspace's repos using pluggable scanners.

---

## M4 — Runtime Topology & Profiles

Model runtime services, their dependencies and owners, and the SITL/HITL/
bench lanes those services run in. Required for evidence collection (M5)
and incident triage (M6) — both need to know what services exist and what
profile produced the data.

- **#14** `feat(core): add runtime profile model for SITL/HITL/bench lanes`
- **#15** `feat(core): model runtime services, dependencies, and ownership`
- **#16** `feat(web): add runtime readiness dashboard for workspace services`
- **#17** `feat(web): add service topology view for profiles`
- **#18** `feat(cli): add runtime status and graph commands`

**Exit criteria**: runtime profiles and services are first-class models,
dashboard renders readiness + topology, CLI exposes status and graph.

---

## M5 — Evidence & Validation

Collect artifacts from running services, organize them into bundles, run
named validation recipes, and surface summaries. Depends on M4 (knows
which services to collect from) and feeds M6 (triage consumes summaries).

- **#19** `feat(core): add artifact bundle model for evidence collection`
- **#20** `feat(core): add artifact collectors for Sprig status/log/evidence paths`
- **#21** `feat(core): add validation recipe registry`
- **#22** `feat(cli): add validate run command for named recipes`
- **#23** `feat(web/core): generate summaries from artifacts and validation results`

**Exit criteria**: `ao validate run <recipe>` collects artifacts, runs the
recipe, and produces a dashboard-visible summary tied back to the bundle.

---

## M6 — Triage & Operations

Higher-order workflows built on everything above: failure triage,
incident dashboards, commissioning templates, cross-repo stack
compatibility, and proactive follow-up suggestions.

- **#24** `feat(core): add failure triage workflow using runtime state and artifacts`
- **#25** `feat(web): add incident triage dashboard view`
- **#26** `feat(core): add commissioning workflow templates for system bring-up`
- **#27** `feat(core): support stack compatibility manifests across repos`
- **#28** `feat(core): suggest follow-up tasks when contracts or shared surfaces change`

**Exit criteria**: failures route through a triage workflow, incident view
in the dashboard, commissioning recipes runnable end-to-end, follow-up
suggestions fire on contract/shared-surface changes.

---

## Notes

- **Sequencing**: M1 → M2 → M3 → M4 → M5 → M6 is the dependency order;
  M2 and M3 can run partially in parallel after M1, and M5/M6 can overlap
  once M4 lands.
- **Re-triage triggers**: a milestone should be revisited if a new issue
  introduces a capability that displaces an existing one, or if a contract
  scanner (M3) surfaces a constraint that reshapes a runtime model (M4).
- **Out of scope**: this triage only covers issues #2–#28. New issues
  filed after 2026-05-12 are not assigned a milestone here.
