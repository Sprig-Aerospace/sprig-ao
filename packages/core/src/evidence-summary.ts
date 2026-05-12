export type EvidenceValidationStatus = "passed" | "failed" | "running" | "unknown";

export interface SummaryArtifact {
  label: string;
  repo?: string;
  kind?: string;
}

export interface SummaryValidationResult {
  label?: string;
  repo?: string;
  status: EvidenceValidationStatus;
}

export interface SessionEvidenceSummaryInput {
  summary?: string | null;
  artifacts?: SummaryArtifact[];
  validations?: SummaryValidationResult[];
}

export interface BundleEvidenceSummaryRepo {
  repo: string;
  summary?: string | null;
  artifacts?: SummaryArtifact[];
  validations?: SummaryValidationResult[];
}

function normalizeText(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const collapsed = value.replace(/[\n\r]+/g, " ").replace(/\s+/g, " ").trim();
  return collapsed ? collapsed : null;
}

function pluralize(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

function summarizeArtifacts(artifacts: SummaryArtifact[]): string | null {
  if (artifacts.length === 0) return null;
  const labels = artifacts
    .map((artifact) => normalizeText(artifact.label))
    .filter((label): label is string => label !== null);
  if (labels.length === 0) return null;
  if (labels.length <= 2) {
    return `Artifacts: ${labels.join(", ")}`;
  }
  return `Artifacts: ${labels.slice(0, 2).join(", ")} +${labels.length - 2} more`;
}

function summarizeValidationCounts(validations: SummaryValidationResult[]): string | null {
  if (validations.length === 0) return null;
  const counts = new Map<EvidenceValidationStatus, number>([
    ["passed", 0],
    ["failed", 0],
    ["running", 0],
    ["unknown", 0],
  ]);

  for (const validation of validations) {
    counts.set(validation.status, (counts.get(validation.status) ?? 0) + 1);
  }

  const ordered: EvidenceValidationStatus[] = ["failed", "running", "passed", "unknown"];
  const parts = ordered
    .map((status) => {
      const count = counts.get(status) ?? 0;
      return count > 0 ? `${count} ${status}` : null;
    })
    .filter((part): part is string => part !== null);

  return parts.length > 0 ? `Validation: ${parts.join(", ")}` : null;
}

function summarizeRepoEvidence(repo: BundleEvidenceSummaryRepo): string {
  const repoName = normalizeText(repo.repo) ?? "repo";
  const detailParts: string[] = [];
  const artifactCount = repo.artifacts?.length ?? 0;
  const validationSummary = summarizeValidationCounts(repo.validations ?? []);

  if (artifactCount > 0) {
    detailParts.push(pluralize(artifactCount, "artifact"));
  }

  if (validationSummary) {
    detailParts.push(validationSummary.replace(/^Validation:\s*/, ""));
  }

  return detailParts.length > 0 ? `${repoName}: ${detailParts.join(", ")}` : repoName;
}

export function buildSessionEvidenceSummary(input: SessionEvidenceSummaryInput): string | null {
  const base = normalizeText(input.summary);
  const artifactSummary = summarizeArtifacts(input.artifacts ?? []);
  const validationSummary = summarizeValidationCounts(input.validations ?? []);
  const parts = [base, artifactSummary, validationSummary].filter(
    (part): part is string => part !== null,
  );
  return parts.length > 0 ? parts.join(" · ") : null;
}

export function buildBundleEvidenceSummary(repos: BundleEvidenceSummaryRepo[]): string | null {
  if (repos.length === 0) return null;

  const repoSummaries = repos.map(summarizeRepoEvidence);
  if (repos.length <= 3) {
    return repoSummaries.join(" · ");
  }

  const totalArtifacts = repos.reduce((sum, repo) => sum + (repo.artifacts?.length ?? 0), 0);
  const allValidations = repos.flatMap((repo) => repo.validations ?? []);
  const parts = [pluralize(repos.length, "repo")];

  if (totalArtifacts > 0) {
    parts.push(pluralize(totalArtifacts, "artifact"));
  }

  const validationSummary = summarizeValidationCounts(allValidations);
  if (validationSummary) {
    parts.push(validationSummary);
  }

  return parts.join(" · ");
}
