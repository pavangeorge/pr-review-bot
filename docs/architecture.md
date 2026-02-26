# Architecture

## Overview

PR Review Bot is built on [CReact](https://github.com/creact-labs/creact) — a meta-runtime that lets you express durable workflows as JSX. The core idea: instead of writing imperative code to manage queues, retries, and state, you declare *what should exist*, and the runtime reconciles it.

## System Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                         GitHub                                   │
│  Developer opens/updates PR  →  Webhook fired to /webhook       │
└────────────────────────┬────────────────────────────────────────┘
                         │ POST /webhook
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│  <Channel port={3000}>                                          │
│                                                                 │
│  • Verifies HMAC-SHA256 signature                               │
│  • Parses GitHub webhook payload                                │
│  • Emits clean PullRequestEvent into reactive graph             │
└────────────────────────┬────────────────────────────────────────┘
                         │ onPullRequest(event)
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│  createSignal<PullRequestEvent[]>(pendingPRs)                   │
│                                                                 │
│  Source of truth. Adding a PR here triggers the For loop below. │
└────────────────────────┬────────────────────────────────────────┘
                         │ reactive update
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│  <For each={() => pendingPRs()}>                                │
│    <Show when={() => !isReviewed(pr.id)}>   ← durability guard  │
│      <ReviewPR pr={pr} ...>                                     │
│        │                                                        │
│        ├─ fetchDiff(pr.diffUrl)           via <GitHub>          │
│        ├─ getReviewTier(pr.changedLines)  reactive signal       │
│        ├─ buildReviewPrompt(pr, diff, tier)                     │
│        ├─ Ollama API call                 (local)               │
│        ├─ postReviewComment(...)          via <GitHub>          │
│        └─ recordReview(...)              → persists to disk     │
│      </ReviewPR>                                                │
│    </Show>                                                      │
│  </For>                                                         │
└─────────────────────────────────────────────────────────────────┘
                         │ writes
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│  .creact-state.json (durable state)                             │
│                                                                 │
│  Persists reviewed PR IDs across process restarts.             │
│  On restart: loads file → <Show> guard prevents re-reviews.     │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│  <Dashboard port={3001}>                                        │
│                                                                 │
│  Independent lifecycle — runs alongside the webhook server.    │
│  Serves review history at http://localhost:3001                 │
└─────────────────────────────────────────────────────────────────┘
```

## Why CReact?

The key question any submission needs to answer: *why is CReact the right tool here?*

**Without CReact**, this bot would be an imperative script:
- A `Set<number>` of seen PR IDs (dies on restart)
- A `Map` or queue to track in-flight reviews
- Manual lifecycle management (what happens if you restart mid-review?)
- Event emitters or callbacks wiring I/O to logic

**With CReact**, the workflow is *declared*:
```tsx
<For each={() => pendingPRs()}>          // map PRs to work units
  {(pr) => (
    <Show when={() => !isReviewed(pr().id)}>  // never double-review
      {() => <ReviewPR pr={pr()} ... />}       // each PR = independent flow
    </Show>
  )}
</For>
```

The runtime handles instance management, reactive updates, and lifecycle. We describe *what should exist*. CReact decides *what needs to change*.

## The Durability Guarantee

The `<Show when={() => !isReviewed(pr.id)}>` guard is where CReact's durable state shines. Here's what happens across a restart:

```
Normal flow:
  Webhook → pendingPRs signal updated → <For> creates ReviewPR → review completes
  → recordReview() writes to .creact-state.json → isReviewed(id) returns true
  → <Show> guard prevents re-run

After restart:
  Bot starts → loads .creact-state.json → isReviewed() already returns true
  for all past PRs → even if GitHub re-fires the webhook, <Show> blocks it
```

One file. One function. Restart safety.

## Review Tiers

PR size is a reactive signal that determines review depth:

| Lines Changed | Tier | Ollama Behavior |
|:---|:---|:---|
| ≤ 50 | Quick ⚡ | Bug check, naming, null checks. 1-3 findings. |
| 51–300 | Standard 🔍 | Logic, edge cases, error handling, perf red flags. ≤5 findings. |
| > 300 | Deep 🏗️ | Architecture, security, scalability, breaking changes. ≤8 findings. |

This is done with a `getReviewTier()` function that maps `changedLines → ReviewTier`, and a `buildReviewPrompt()` function that selects the appropriate instructions based on tier. The tier is derived reactively from the PR signal — if a PR is amended and grows past 300 lines, the next review of it would automatically use the deep tier.

## Security Decisions

**Webhook signature verification**: Every incoming webhook is HMAC-SHA256 verified against `GITHUB_WEBHOOK_SECRET`. We use `crypto.timingSafeEqual` to prevent timing attacks. A bot without this is trivially exploitable — anyone who discovers your webhook URL can trigger fake reviews.

**Narrow token scopes**: The `GITHUB_TOKEN` only needs `repo` (to read PRs and post reviews). We don't request admin or write-to-settings scopes.

**Diff truncation**: Diffs are truncated at 12,000 characters before being sent to Ollama. This prevents both runaway context size and prompt injection attacks via malicious file content.

## Trade-offs and What's Next

**Flat JSON state vs. database**: The current `FileBackend` is simple and zero-dependency. For a production deployment monitoring multiple high-traffic repos, you'd replace it with SQLite (via `better-sqlite3`) or Postgres. The interface is the same — only `loadState()` and `saveState()` need to change.

**No retry logic**: If Ollama or GitHub APIs are temporarily unavailable, the review is dropped. A production version would add exponential backoff via a CReact `<Retry>` wrapper component.

**Single-repo focus**: The bot monitors the repo specified in `GITHUB_REPO` env. Multi-repo support is architecturally simple — `pendingPRs` would become `Record<string, PullRequestEvent[]>` and the `<For>` would nest.
