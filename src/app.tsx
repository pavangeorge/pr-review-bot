// ─────────────────────────────────────────────────────────────────────────────
// App — The Reactive Workflow Graph
//
// This file is the heart of the submission. Read it like a sentence:
//
//   "Listen for webhooks on port 3000. For each open pull request that hasn't
//    been reviewed yet, use Ollama to review it and post the result to GitHub.
//    Show review history on a dashboard at port 8080."
//
// That's it. That's the whole bot. The complexity lives in the components —
// the App just declares WHAT should happen. CReact handles HOW.
//
// This is the difference between a workflow declared in JSX and the same
// logic written imperatively. Imperative code tells the computer what to do.
// Declarative CReact code tells the runtime what should exist.
// ─────────────────────────────────────────────────────────────────────────────

import { createSignal, For, Show } from "@creact-labs/creact";
import { Channel } from "./components/channel";
import { GitHub, type GitHubAPI } from "./components/github";
import { ReviewPR } from "./components/review-pr";
import type { PullRequestEvent } from "./types/index";
import { StateManager, isReviewed } from "./components/state";
import { HttpServer } from "./components/http-server";

// ── Configuration ─────────────────────────────────────────────────────────────
// We fail fast on missing config. A bot that silently misconfigures is worse
// than one that refuses to start with a clear error message.

const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL ?? "http://localhost:11434";
const OLLAMA_MODEL = process.env.OLLAMA_MODEL ?? "llama3.2";
const GITHUB_TOKEN = requireEnv("GITHUB_TOKEN");
const WEBHOOK_SECRET = requireEnv("GITHUB_WEBHOOK_SECRET");
const WEBHOOK_PORT = parseInt(process.env.WEBHOOK_PORT ?? "3000", 10);
const DASHBOARD_PORT = WEBHOOK_PORT + 1;

function requireEnv(name: string): string {
    const v = process.env[name];
    if (v === undefined || v === "") {
        console.error(`❌ Missing required environment variable: ${name}`);
        process.exit(1);
    }
    return v;
}

// ── Reactive State ────────────────────────────────────────────────────────────
//
// pendingPRs is the source of truth for all work in flight.
//
// When a webhook arrives → a PR is added to pendingPRs
// When a review completes → the PR is removed from pendingPRs
//
// The <For> loop below reacts to this signal automatically. No polling.
// No event emitters. No queues to manage. The reactive graph does it.

const [pendingPRs, setPendingPRs] = createSignal<PullRequestEvent[]>([]);

function handlePullRequest(event: PullRequestEvent): void {
    // Guard: don't add a PR we've already reviewed (durable state check)
    if (isReviewed(event.id)) {
        console.log(
            `[App] ⏭️  PR #${event.number} already reviewed — skipping`
        );
        return;
    }

    // Guard: don't add a PR already in the pending queue
    if (pendingPRs().some((pr) => pr.id === event.id)) {
        console.log(
            `[App] ⏭️  PR #${event.number} already in queue — skipping`
        );
        return;
    }

    console.log(`[App] ➕ Queuing PR #${event.number} for review`);
    setPendingPRs((current) => [...current, event]);
}

function handleReviewComplete(prId: number): void {
    // Remove from pending — this triggers CReact to unmount the ReviewPR
    // component instance for this PR. Clean, no memory leaks.
    setPendingPRs((current) => current.filter((pr) => pr.id !== prId));
    console.log(`[App] 🗑️  Removed PR ${prId} from pending queue`);
}

// ── The App ───────────────────────────────────────────────────────────────────

export function App() {
    return (
        <>
            {/* ── Persistent State ──────────────────────────────────────────────
          Must be mounted first. StateManager registers the useAsyncOutput
          hook that persists review records through FileMemory. All other
          components depend on isReviewed() which reads from this store. */}
            <StateManager key="pr-review-bot-state" />

            {/* ── Webhook Receiver ──────────────────────────────────────────────
            Listens on WEBHOOK_PORT for GitHub webhook events.
            Emits clean PullRequestEvent objects into our reactive graph.
            Lifecycle-aware: starts on mount, closes server on cleanup. */}
            <Channel
                port={WEBHOOK_PORT}
                webhookSecret={WEBHOOK_SECRET}
                onPullRequest={handlePullRequest}
            />

            {/* ── Dashboard UI ──────────────────────────────────────────────────
          Hono static server + JSON API on DASHBOARD_PORT.
          Serves the Preact frontend from resources/dashboard/.
          Pattern from CReact docs Chapter 5. */}
            <HttpServer port={DASHBOARD_PORT} path="./resources/dashboard" />

            {/* ── GitHub Provider ───────────────────────────────────────────────
            Initializes the GitHub API client once. All children share it.
            This is the "provider" pattern: declare the context, use it inside. */}
            <GitHub token={GITHUB_TOKEN}>
                {(github: GitHubAPI) => (
                    <>
                        {/*
               * ── The Core Reactive Loop ─────────────────────────────────
               *
               * <For> maps each pending PR to its own ReviewPR instance.
               * CReact creates component instances as PRs arrive and destroys
               * them as reviews complete. This is declarative concurrency:
               * multiple PRs are reviewed in parallel, each as its own
               * independent unit of work.
               *
               * <Show> is the durability guard. It prevents any PR that has
               * already been reviewed (either this session or a previous one,
               * loaded from disk) from ever reaching ReviewPR again.
               *
               * Together, <For> + <Show> express the entire scheduling and
               * deduplication policy in 6 lines of JSX. Without CReact, this
               * would be a queue manager, a set of "seen" IDs, and manual
               * lifecycle cleanup.
               */}
                        <For each={() => pendingPRs()}>
                            {(pr) => (
                                <Show when={() => !isReviewed(pr().id)}>
                                    {() => (
                                        <ReviewPR
                                            pr={pr()}
                                            github={github}
                                            ollamaBaseUrl={OLLAMA_BASE_URL}
                                            ollamaModel={OLLAMA_MODEL}
                                            onComplete={handleReviewComplete}
                                        />
                                    )}
                                </Show>
                            )}
                        </For>
                    </>
                )}
            </GitHub>
        </>
    );
}
