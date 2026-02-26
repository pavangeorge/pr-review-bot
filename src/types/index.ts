// ─────────────────────────────────────────────────────────────────────────────
// Shared Types
//
// We define our domain types here, separate from implementation, for two
// reasons: (1) it forces us to think about the data model up front, and
// (2) it gives CReact components a shared language — props flow between
// components typed, not guessed.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A pull request event received from the GitHub webhook.
 * We only capture the fields we actually use — keeping the surface area small
 * makes the system easier to reason about.
 */
export interface PullRequestEvent {
  /** GitHub's numeric ID for this PR — our canonical deduplication key */
  id: number;
  /** PR number shown in GitHub UI (e.g. #42) */
  number: number;
  /** Human-readable title of the PR */
  title: string;
  /** Author's GitHub login */
  author: string;
  /** The body/description text the author wrote */
  body: string | null;
  /** Full repo name: "owner/repo" */
  repo: string;
  /** Base branch being merged into (e.g. "main") */
  baseBranch: string;
  /** Head branch with the changes (e.g. "feature/auth") */
  headBranch: string;
  /** GitHub API URL to fetch the diff */
  diffUrl: string;
  /** Direct link to the PR in the GitHub web UI */
  htmlUrl: string;
  /** Total lines changed — used for tiered review depth */
  changedLines: number;
  /** ISO timestamp when the PR was opened */
  createdAt: string;
}

/**
 * The result of a Claude code review.
 * Structured output means we can render it cleanly as a GitHub comment.
 */
export interface ReviewResult {
  /** One-line executive summary of the PR */
  summary: string;
  /** Overall quality signal */
  verdict: "approve" | "request_changes" | "comment";
  /** Severity level used for tiered routing */
  severity: "low" | "medium" | "high";
  /** Individual review findings, each actionable */
  findings: ReviewFinding[];
  /** Positive things worth calling out */
  positives: string[];
  /** Raw markdown body to post as a GitHub comment */
  commentBody: string;
}

export interface ReviewFinding {
  /** File path the finding relates to (if applicable) */
  file?: string;
  /** Short label: "Bug", "Security", "Performance", "Style", etc. */
  category: string;
  /** Full description of the issue */
  description: string;
  /** Concrete suggestion for fixing it */
  suggestion: string;
  /** How serious is this? */
  severity: "low" | "medium" | "high";
}

/**
 * Persisted record of a completed review.
 * Stored in CReact's durable state to prevent re-reviewing on restart.
 */
export interface ReviewRecord {
  prId: number;
  prNumber: number;
  repo: string;
  reviewedAt: string;
  verdict: ReviewResult["verdict"];
  /** GitHub comment ID — useful for future "update review" flows */
  commentId?: number;
}

/**
 * Review tier — determines how deep Claude goes.
 * Small PRs get fast feedback. Large PRs get architectural analysis.
 * This is a core CReact showcase: pr size is a reactive signal that
 * drives which prompt template gets rendered.
 */
export type ReviewTier = "quick" | "standard" | "deep";

export function getReviewTier(changedLines: number): ReviewTier {
  if (changedLines <= 50) return "quick";
  if (changedLines <= 300) return "standard";
  return "deep";
}
