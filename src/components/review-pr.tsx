// ─────────────────────────────────────────────────────────────────────────────
// ReviewPR Component
//
// This is the most important component. It represents a single PR review
// as a self-contained unit of work. When CReact renders this component, it:
//
//   1. Fetches the PR diff from GitHub
//   2. Determines the review tier (quick / standard / deep) based on PR size
//   3. Builds the appropriate prompt
//   4. Calls Claude via the Anthropic API
//   5. Posts the review back to GitHub
//   6. Records the review durably to prevent re-runs
//
// Each PR that appears in the <For each={pendingPRs}> list becomes its own
// instance of this component. CReact manages their lifecycles independently.
// If 3 PRs are pending, 3 ReviewPR components run concurrently.
//
// This is the "reactive execution" showcase — complex stateful async work,
// expressed as a component.
// ─────────────────────────────────────────────────────────────────────────────

import { onMount } from "@creact-labs/creact";
import Anthropic from "@anthropic-ai/sdk";
import type { PullRequestEvent, ReviewResult } from "../types/index";
import type { GitHubAPI } from "./github";
import {
  buildReviewPrompt,
  formatGitHubComment,
} from "../prompts/review";
import { getReviewTier } from "../types/index";
import { recordReview } from "./state";

interface ReviewPRProps {
  pr: PullRequestEvent;
  github: GitHubAPI;
  anthropicApiKey: string;
  onComplete: (prId: number) => void;
}

export function ReviewPR(props: ReviewPRProps) {
    onMount(async () => {
      const { pr, github, anthropicApiKey, onComplete } = props;

      console.log(
        `\n[ReviewPR] 🔄 Starting review for PR #${pr.number}: "${pr.title}"`
      );

      // ── Step 1: Safety check — did the bot already comment? ───────────────
      // This is our second line of defence after the <Show> guard in App.
      // The <Show> checks our local state; this checks GitHub directly.
      // Belt-and-suspenders reliability.
      const alreadyCommented = await github.botAlreadyCommented(
        pr.repo,
        pr.number
      );
      if (alreadyCommented) {
        console.log(
          `[ReviewPR] ⏭️  Skipping PR #${pr.number} — bot already commented`
        );
        onComplete(pr.id);
        return;
      }

      // ── Step 2: Fetch the diff ─────────────────────────────────────────────
      const diff = await github.fetchDiff(pr.diffUrl);
      if (!diff) {
        console.warn(
          `[ReviewPR] ⚠️  Empty diff for PR #${pr.number} — skipping`
        );
        onComplete(pr.id);
        return;
      }

      // ── Step 3: Determine review tier ─────────────────────────────────────
      // This is the reactive logic showcase: tier is derived from pr.changedLines.
      // A small PR gets a quick, focused review. A large architectural PR gets
      // deep analysis. The prompt changes, the depth changes — all reactive.
      const tier = getReviewTier(pr.changedLines);
      console.log(
        `[ReviewPR] 📊 PR #${pr.number}: ${pr.changedLines} lines → "${tier}" review tier`
      );

      // ── Step 4: Build the prompt ───────────────────────────────────────────
      const { system, user } = buildReviewPrompt(pr, diff, tier);

      // ── Step 5: Call Claude ────────────────────────────────────────────────
      let reviewResult: ReviewResult;
      try {
        const client = new Anthropic({ apiKey: anthropicApiKey });

        console.log(`[ReviewPR] 🤖 Sending PR #${pr.number} to Claude...`);
        const message = await client.messages.create({
          model: "claude-opus-4-6",
          max_tokens: tier === "deep" ? 4096 : tier === "standard" ? 2048 : 1024,
          system,
          messages: [{ role: "user", content: user }],
        });

        const raw =
          message.content[0].type === "text" ? message.content[0].text : "";

        reviewResult = parseReviewResult(raw, pr);
      } catch (err) {
        console.error(
          `[ReviewPR] ❌ Claude API error for PR #${pr.number}:`,
          err
        );
        onComplete(pr.id);
        return;
      }

      // ── Step 6: Format and post the GitHub comment ─────────────────────────
      const verdictMap: Record<
        ReviewResult["verdict"],
        "APPROVE" | "REQUEST_CHANGES" | "COMMENT"
      > = {
        approve: "APPROVE",
        request_changes: "REQUEST_CHANGES",
        comment: "COMMENT",
      };

      const commentBody = formatGitHubComment(
        pr.number,
        tier,
        reviewResult.commentBody
      );

      const commentId = await github.postReviewComment(
        pr.repo,
        pr.number,
        commentBody,
        verdictMap[reviewResult.verdict]
      );

      // ── Step 7: Persist durably ────────────────────────────────────────────
      // This is what makes the bot restart-safe. After recording, the <Show>
      // guard in App will never route this PR to ReviewPR again.
      recordReview({
        prId: pr.id,
        prNumber: pr.number,
        repo: pr.repo,
        reviewedAt: new Date().toISOString(),
        verdict: reviewResult.verdict,
        commentId: commentId > 0 ? commentId : undefined,
      });

      console.log(
        `[ReviewPR] ✅ PR #${pr.number} reviewed: ${reviewResult.verdict.toUpperCase()} — "${reviewResult.summary}"`
      );

      // Signal to App that this PR is done — triggers signal update,
      // which removes it from the pendingPRs list
      onComplete(pr.id);
    });

    return <></>;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function parseReviewResult(
  raw: string,
  pr: PullRequestEvent
): ReviewResult {
  try {
    // Strip any accidental markdown fences Claude might add
    const cleaned = raw.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
    const parsed = JSON.parse(cleaned) as ReviewResult;
    return parsed;
  } catch (err) {
    console.warn(
      `[ReviewPR] ⚠️  Could not parse Claude JSON response for PR #${pr.number}, using fallback`
    );
    // Graceful fallback — never crash because of a parse error
    return {
      summary: `Review for "${pr.title}"`,
      verdict: "comment",
      severity: "low",
      findings: [],
      positives: [],
      commentBody: `I reviewed this PR but encountered an issue formatting the structured output. Here's the raw analysis:\n\n${raw}`,
    };
  }
}
