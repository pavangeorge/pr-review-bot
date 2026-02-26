<div align="center">

# 🤖 PR Review Bot

### AI-powered GitHub pull request reviews — durable, reactive, and restart-safe

Built with **[CReact](https://github.com/creact-labs/creact)** + **Ollama** (local LLM)

[![CReact](https://img.shields.io/badge/built%20with-CReact-blue?style=flat-square)](https://github.com/creact-labs/creact)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.3-3178c6?style=flat-square&logo=typescript)](https://www.typescriptlang.org/)
[![Ollama](https://img.shields.io/badge/AI-Ollama-orange?style=flat-square)](https://ollama.ai)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg?style=flat-square)](./LICENSE)

</div>

---

## The Problem

Every engineering team carries a silent tax: **pull requests sit unreviewed for hours**. Context switches are expensive. Junior developers get inconsistent feedback. Senior engineers burn review time on style issues instead of architecture. And none of the existing tools — GitHub Actions, linters, static analyzers — actually *think* about your code.

Existing CI bots are **stateless and dumb**. They run, they exit, they forget. Restart your webhook server mid-review? It either re-reviews PRs it already handled, or drops work entirely. There's no durable memory of what's been done.

## The Solution

PR Review Bot watches your GitHub repository for new pull requests and automatically posts a structured, actionable AI code review — using **Ollama** (local LLM) to reason about logic, security, architecture, and style.

What makes it different:

- **Durable** — Survived process restarts without re-reviewing or dropping PRs. State is persisted and loaded on startup.
- **Reactive** — Built on CReact's signal-driven execution model. New PRs arrive → the reactive graph responds instantly.
- **Tiered** — Small PRs get quick, focused feedback. Large architectural PRs get deep analysis. Ollama adapts to context.
- **Verified** — Every webhook is HMAC-SHA256 verified. No spoofed reviews.

---

## Demo

```
🤖 PR Review Bot starting...
   Built with CReact — durable, reactive, restart-safe

[Channel]   🚀 Webhook server listening on http://localhost:3000/webhook
[Dashboard] 🖥️  Dashboard available at http://localhost:3001
[GitHub]    🔑 Authenticated as @pr-review-bot
[State]     💾 Loaded 12 past review(s) from disk

[Channel]   📬 PR #47 received — "Add OAuth2 login flow" by @alice (312 lines changed)
[App]       ➕ Queuing PR #47 for review
[GitHub]    📄 Fetched diff (8,432 chars)
[ReviewPR]  📊 PR #47: 312 lines → "deep" review tier
[ReviewPR]  🤖 Sending PR #47 to Ollama...
[GitHub]    💬 Posted REQUEST_CHANGES review on PR #47 (review id: 1893245)
[State]     ✅ Recorded review for PR #47 (org/repo)
[App]       🗑️  Removed PR 47 from pending queue
```

**Review posted to GitHub:**

> ## 🤖 AI Code Review — 🏗️ Deep Architectural Review
>
> This PR introduces OAuth2 login via GitHub and Google. The implementation is mostly correct but has three security concerns worth addressing before merge.
>
> **🔴 Security — Token Storage**
> Access tokens are stored in `localStorage`. These are accessible to any JavaScript on the page (XSS risk). Prefer `httpOnly` cookies.
>
> **🟡 Performance — Redundant API Call**
> `validateSession()` is called on every render of `<AuthProvider>`. Cache the result with `useMemo` or move validation to a context initializer.
>
> **✅ What's done well**
> Clean separation of OAuth callback handling. Good use of PKCE flow.

---

## How It Works

CReact lets you express this entire workflow as a **declarative JSX component tree**:

```tsx
export function App() {
  return (
    <>
      {/* Listen for GitHub webhooks */}
      <Channel port={3000} webhookSecret={WEBHOOK_SECRET}
               onPullRequest={handlePullRequest} />

      {/* Review history dashboard */}
      <Dashboard port={3001} />

      {/* GitHub API provider */}
      <GitHub token={GITHUB_TOKEN}>
        {(github) => (
          // For each pending PR...
          <For each={() => pendingPRs()}>
            {(pr) => (
              // ...that hasn't been reviewed yet (durability guard)...
              <Show when={() => !isReviewed(pr().id)}>
                {() => (
                  // ...run a full AI review
                  <ReviewPR pr={pr()} github={github}
                            ollamaBaseUrl={OLLAMA_BASE_URL}
                            ollamaModel={OLLAMA_MODEL}
                            onComplete={handleReviewComplete} />
                )}
              </Show>
            )}
          </For>
        )}
      </GitHub>
    </>
  );
}
```

Read it like a sentence: *"For each pending PR that hasn't been reviewed, run a review."*

**`<For>`** maps each pending PR to its own independent `ReviewPR` component instance — enabling concurrent reviews.

**`<Show>`** is the durability guard. It checks our persistent state before every render. Even after a restart, PRs reviewed in previous sessions are never re-reviewed.

**`<GitHub>`** and **`<Channel>`** are lifecycle-aware providers — they initialize on mount and clean up on unmount. CReact manages their lifecycles.

**`createSignal`** is the reactive heartbeat. When a webhook fires, we add a PR to `pendingPRs`. The `<For>` loop reacts instantly — no polling, no event emitters, no queues to manage.

See [`docs/architecture.md`](./docs/architecture.md) for the full system diagram and design decisions.

---

## Review Tiers

PR size is a reactive signal that determines how deep Ollama goes:

| Lines Changed | Tier | What Ollama Analyzes |
|:---|:---|:---|
| ≤ 50 | ⚡ Quick | Obvious bugs, naming clarity, missing null checks |
| 51–300 | 🔍 Standard | Logic, edge cases, error handling, performance red flags |
| > 300 | 🏗️ Deep | Architecture, security, scalability, breaking changes |

---

## Setup

### Prerequisites

- Node.js 20.10+
- A **target repository** — the GitHub repo whose pull requests you want the bot to review. This should be a repo **other than** this one (pr-review-bot). You'll configure the bot to watch this repo and create a webhook there so PR events are sent to the bot.
- [Ollama](https://ollama.ai) installed and running locally (`ollama serve`), with a model pulled (e.g. `ollama pull llama3.2`)
- A GitHub Personal Access Token for the target repo (see below)

### 1. Clone and install

```bash
git clone https://github.com/pavangeorge/pr-review-bot
cd pr-review-bot
npm install
```

### 2. Configure environment

```bash
cp .env.example .env
```

Edit `.env` and fill in:

- **`GITHUB_TOKEN`** — A fine-grained Personal Access Token for the **target repo** (see [Creating a GitHub token](#creating-a-github-token) below).
- **`GITHUB_WEBHOOK_SECRET`** — A random string used to verify webhook payloads (e.g. `openssl rand -hex 20`).
- **`GITHUB_REPO`** — The **target repository** in `owner/repo` form (the repo whose PRs you want reviewed; not this pr-review-bot repo).

```env
GITHUB_TOKEN=ghp_...
GITHUB_WEBHOOK_SECRET=your_random_secret
GITHUB_REPO=owner/repo
WEBHOOK_PORT=3000
```

Optional (Ollama defaults): `OLLAMA_BASE_URL=http://localhost:11434`, `OLLAMA_MODEL=llama3.2`. Ensure Ollama is running and the model is pulled (`ollama pull llama3.2`).

#### Creating a GitHub token

The bot needs a **fine-grained** Personal Access Token (not a classic PAT) with minimal permissions:

| Permission    | Level          | Why |
|---------------|----------------|-----|
| **Pull requests** | Read and write | Read PR metadata and post review comments |
| **Contents**       | Read only      | Fetch the diff via the API |

**Steps:**

1. **GitHub** → **Settings** → **Developer settings** → **Personal access tokens** → **Fine-grained tokens** → **Generate new token**.
2. Set **Resource owner** to your account.
3. Under **Repository access**, choose **Only select repositories** and pick your **target repo** (the one whose PRs you want reviewed).
4. Under **Permissions**, set **Pull requests** to *Read and write* and **Contents** to *Read-only*. Leave everything else with no access.
5. Set an expiration (e.g. 90 days for a competition or short-term use).
6. Generate the token and paste it into `.env` as `GITHUB_TOKEN`.

### 3. Expose your local server (for development)

GitHub needs to reach your webhook server. Use [smee.io](https://smee.io) to tunnel webhooks locally:

```bash
# Install smee client
npm install -g smee-client

# Start the tunnel (replace with your smee URL)
smee --url https://smee.io/YOUR_CHANNEL_ID --target http://localhost:3000/webhook
```

### 4. Configure the GitHub webhook

Create the webhook **in your target repository** (the repo you set as `GITHUB_REPO`), not in the pr-review-bot repo. That way, when someone opens or updates a PR in the target repo, GitHub will send events to your bot.

1. Go to your **target repo** on GitHub → **Settings** → **Webhooks** → **Add webhook**
2. **Payload URL**: your smee URL (or your server's public URL in production)
3. **Content type**: `application/json`
4. **Secret**: same value as `GITHUB_WEBHOOK_SECRET` in your `.env`
5. **Which events**: select **"Pull requests"** only

### 5. Start the bot

```bash
npm run dev
```

The bot is now live:
- **Webhook receiver**: `http://localhost:3000/webhook`
- **Dashboard**: `http://localhost:3001`

Open a PR in your **target repository** and watch it get reviewed.

---

## Project Structure

```
pr-review-bot/
├── src/
│   ├── app.tsx                  # The reactive workflow graph (read this first)
│   ├── components/
│   │   ├── channel.tsx          # HTTP webhook receiver + signature verification
│   │   ├── github.tsx           # GitHub API provider (Octokit wrapper)
│   │   ├── review-pr.tsx        # Core AI review logic — the main CReact showcase
│   │   ├── dashboard.tsx        # Review history HTTP server
│   │   └── state.tsx            # Durable persistent state (restart-safe)
│   ├── prompts/
│   │   └── review.ts            # Prompt templates (first-class, versioned)
│   └── types/
│       └── index.ts             # Shared TypeScript interfaces
├── resources/
│   └── dashboard/
│       └── index.html           # Dashboard UI
├── docs/
│   └── architecture.md          # System diagram + design decisions
├── index.tsx                    # Entry point
├── .env.example                 # Configuration template
├── package.json
└── tsconfig.json
```

---

## Design Decisions

**Why treat prompts as a separate module?**
Prompt engineering is code. Burying prompts as strings inside component logic makes them impossible to version, test, or iterate on. `src/prompts/review.ts` is a first-class module — same standards as any other code.

**Why JSON file state instead of a database?**
For a bot monitoring one repo, a flat JSON file is simple, zero-dependency, and survives typical restart scenarios. The `loadState()`/`saveState()` interface is clean — swapping in SQLite or Postgres is a one-file change.

**Why `<Show>` instead of filtering `pendingPRs`?**
The `<Show when={() => !isReviewed(pr.id)}>` guard runs at render time, after every signal update. This means even if a PR somehow enters `pendingPRs` twice (e.g. a synchronize webhook fires during an active review), the guard catches it. Defence in depth.

**Why `timingSafeEqual` for webhook verification?**
Standard string comparison (`===`) leaks timing information — an attacker can infer how many leading characters of their guess are correct. `crypto.timingSafeEqual` compares in constant time, eliminating this attack vector.

---

## What's Next

- **Retry logic** — CReact `<Retry>` wrapper for transient API failures
- **Multi-repo support** — extend `pendingPRs` to `Record<string, PullRequestEvent[]>`
- **Incremental reviews** — detect when a PR updates and re-review only changed files
- **Review quality scoring** — track whether authors act on findings over time

---

<div align="center">

Built for the **CReact Best App Challenge** — February 2026

Made with ❤️ by [@pavangeorge](https://github.com/pavangeorge)

</div>
