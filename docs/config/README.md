# Workspace Config

This directory holds workspace-level configuration artifacts that sit above any single repository's `agent-orchestrator.yaml`.

## Files

- [`sprig-workspace-manifest.yaml`](./sprig-workspace-manifest.yaml) — initial cross-repo manifest for Sprig workspace awareness.

## Notes

- The manifest is intentionally lightweight and assumption-driven.
- Dependency edges describe workspace coordination and integration relationships, not guaranteed package-manager imports.
- Ownership entries are notes for review routing until a formal CODEOWNERS map exists across the workspace.
