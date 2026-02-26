// ─────────────────────────────────────────────────────────────────────────────
// Prompt Templates
//
// We separate prompts from component logic for two reasons:
//
// 1. PROMPT ENGINEERING IS CODE. Treating prompts as buried strings inside
//    functions makes them impossible to version, test, or iterate on.
//    Giving them their own module says: this matters.
//
// 2. TIERED DEPTH. Different PR sizes need different levels of analysis.
//    Quick reviews focus on obvious bugs and style. Deep reviews add
//    architecture, security, and performance analysis. This is a reactive
//    decision — the tier is derived from a signal (PR line count).
// ─────────────────────────────────────────────────────────────────────────────

import type { PullRequestEvent, ReviewTier } from "../types/index";

const SYSTEM_PROMPT = `You are an expert code reviewer with deep experience in software engineering best practices, security, and architecture. Your reviews are precise, actionable, and respectful.

You output ONLY valid JSON — no markdown fences, no preamble, no explanation outside the JSON object.

Your tone is that of a senior engineer who wants the author to succeed: direct but constructive.`;

/**
 * Builds the review prompt based on tier.
 *
 * Trade-off: We could use a single mega-prompt for all tiers, but that
 * wastes tokens on small PRs and produces overwhelming feedback for minor
 * changes. Tiered prompts respect the reviewer's time and the author's context.
 */
export function buildReviewPrompt(
  pr: PullRequestEvent,
  diff: string,
  tier: ReviewTier
): { system: string; user: string } {
  const tierInstructions = {
    quick: `This is a QUICK review (small PR, ≤50 lines changed).
Focus on:
- Obvious bugs or logic errors
- Naming clarity
- Missing null/error checks
Keep findings to the most important 1-3 items. Be brief.`,

    standard: `This is a STANDARD review (medium PR, 51-300 lines changed).
Focus on:
- Logic correctness and edge cases
- Code clarity and maintainability
- Error handling and defensive coding
- Performance red flags (N+1 queries, unnecessary re-computation)
Provide up to 5 findings. Be specific.`,

    deep: `This is a DEEP ARCHITECTURAL review (large PR, >300 lines changed).
Focus on:
- Overall architecture and design decisions
- Security vulnerabilities (injection, auth bypass, data exposure)
- Performance and scalability implications
- Test coverage gaps
- Breaking changes or API contract violations
- Long-term maintainability concerns
Be thorough. Up to 8 findings. Explain the "why" behind each concern.`,
  };

  const user = `Review this pull request and respond with ONLY a JSON object matching this exact schema:

{
  "summary": "One sentence describing what this PR does",
  "verdict": "approve" | "request_changes" | "comment",
  "severity": "low" | "medium" | "high",
  "findings": [
    {
      "file": "optional/path/to/file.ts",
      "category": "Bug | Security | Performance | Style | Architecture | Testing",
      "description": "What the problem is",
      "suggestion": "Concrete fix or improvement",
      "severity": "low" | "medium" | "high"
    }
  ],
  "positives": ["Things done well worth acknowledging"],
  "commentBody": "Full markdown-formatted review to post as a GitHub comment. Use headers, code blocks, and emojis appropriately."
}

---
PR #${pr.number}: ${pr.title}
Author: ${pr.author}
Repository: ${pr.repo}
Base ← Head: ${pr.baseBranch} ← ${pr.headBranch}
Lines changed: ${pr.changedLines}
${pr.body ? `\nPR Description:\n${pr.body}\n` : ""}
---
DIFF:
${diff.slice(0, 12000)}${diff.length > 12000 ? "\n\n[diff truncated — showing first 12,000 chars]" : ""}`;

  return {
    system: `${SYSTEM_PROMPT}\n\n${tierInstructions[tier]}`,
    user,
  };
}

/**
 * Formats a ReviewResult into a polished GitHub comment body.
 *
 * We keep this separate from the prompt so that if we ever want to adjust
 * comment formatting (e.g. add a bot signature, change emoji style), we
 * change this function — not the AI prompt.
 */
export function formatGitHubComment(
  prNumber: number,
  tier: ReviewTier,
  rawCommentBody: string
): string {
  const tierBadge = {
    quick: "⚡ Quick Review",
    standard: "🔍 Standard Review",
    deep: "🏗️ Deep Architectural Review",
  }[tier];

  return `## 🤖 AI Code Review — ${tierBadge}

${rawCommentBody}

---
<sub>Reviewed by <a href="https://github.com/pavangeorge/pr-review-bot">PR Review Bot</a> · Powered by <a href="https://github.com/creact-labs/creact">CReact</a> + Ollama</sub>`;
}
