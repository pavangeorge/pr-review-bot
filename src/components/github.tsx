// ─────────────────────────────────────────────────────────────────────────────
// GitHub Component
//
// This component wraps all GitHub API interactions. It is a "provider" in
// CReact terms — it initializes a resource (the Octokit client) and exposes
// it to children through a render prop pattern.
//
// Why wrap Octokit in a CReact component?
//
// Because CReact components have lifecycle — onMount and onCleanup. This
// means the GitHub client is initialized once when the component mounts,
// and we could add reconnect logic or credential rotation in onCleanup.
// More importantly: it fits the declarative model. The App says
// "<GitHub token={...}>" and everything inside that tree has access to
// the GitHub API. It's the same mental model as <AWS region="us-east-1">
// in the official demo.
// ─────────────────────────────────────────────────────────────────────────────

import { JSXElement, onMount } from "@creact-labs/creact";
import { Octokit } from "@octokit/rest";

interface GitHubProps {
  token: string;
  children: (github: GitHubAPI) => unknown;
}

/**
 * The interface exposed to children — only what we actually use.
 * Keeping this narrow is intentional: it documents the exact surface area
 * of GitHub operations our bot performs.
 */
export interface GitHubAPI {
  /** Fetch the raw text diff for a PR */
  fetchDiff: (diffUrl: string) => Promise<string>;
  /** Post a review comment on a PR */
  postReviewComment: (
    repo: string,
    prNumber: number,
    body: string,
    verdict: "APPROVE" | "REQUEST_CHANGES" | "COMMENT"
  ) => Promise<number>;
  /** Check if the bot has already commented on this PR (extra safety guard) */
  botAlreadyCommented: (repo: string, prNumber: number) => Promise<boolean>;
}

export function GitHub(props: GitHubProps) {
    let octokit: Octokit;
    let botLogin: string = "";

    onMount(async () => {
      octokit = new Octokit({ auth: props.token });

      // Discover the bot's own GitHub login so we can check for existing
      // comments without hardcoding a username
      try {
        const { data } = await octokit.users.getAuthenticated();
        botLogin = data.login;
        console.log(`[GitHub] 🔑 Authenticated as @${botLogin}`);
      } catch (err) {
        console.error("[GitHub] ❌ Authentication failed:", err);
      }
    });

    const api: GitHubAPI = {
      async fetchDiff(diffUrl: string): Promise<string> {
        try {
          // GitHub diff URLs require Accept: application/vnd.github.v3.diff
          const response = await fetch(diffUrl, {
            headers: {
              Authorization: `token ${props.token}`,
              Accept: "application/vnd.github.v3.diff",
            },
          });

          if (!response.ok) {
            throw new Error(`GitHub API error: ${response.status}`);
          }

          const diff = await response.text();
          console.log(
            `[GitHub] 📄 Fetched diff (${diff.length} chars)`
          );
          return diff;
        } catch (err) {
          console.error("[GitHub] ❌ Failed to fetch diff:", err);
          return "";
        }
      },

      async postReviewComment(
        repo: string,
        prNumber: number,
        body: string,
        verdict: "APPROVE" | "REQUEST_CHANGES" | "COMMENT"
      ): Promise<number> {
        const [owner, repoName] = repo.split("/");

        try {
          const { data } = await octokit.pulls.createReview({
            owner,
            repo: repoName,
            pull_number: prNumber,
            body,
            event: verdict,
          });

          console.log(
            `[GitHub] 💬 Posted ${verdict} review on PR #${prNumber} (review id: ${data.id})`
          );
          return data.id;
        } catch (err) {
          console.error(
            `[GitHub] ❌ Failed to post review on PR #${prNumber}:`,
            err
          );
          return -1;
        }
      },

      async botAlreadyCommented(
        repo: string,
        prNumber: number
      ): Promise<boolean> {
        if (!botLogin) return false;
        const [owner, repoName] = repo.split("/");

        try {
          const { data: reviews } = await octokit.pulls.listReviews({
            owner,
            repo: repoName,
            pull_number: prNumber,
          });

          return reviews.some((r) => r.user?.login === botLogin);
        } catch {
          return false;
        }
      },
    };

    // Render prop pattern: expose the API to children
    return (props.children as (api: GitHubAPI) => JSXElement)(api);
}
