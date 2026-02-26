// ─────────────────────────────────────────────────────────────────────────────
// Channel Component
//
// This is our "edge" — the boundary between the external world (GitHub
// webhooks) and our reactive CReact graph.
//
// Design decision: We keep HTTP concerns entirely inside this component.
// The App never sees raw request objects. It only sees clean PullRequestEvent
// objects emitted through the onPullRequest callback. This is the same
// pattern the official CReact demo uses with <Channel> for HTTP — proven
// and idiomatic.
//
// Webhook verification: We HMAC-verify every incoming payload using the
// GitHub webhook secret. Without this, anyone who knows your webhook URL
// can trigger fake reviews. This is not optional in production.
// ─────────────────────────────────────────────────────────────────────────────

import { onMount, onCleanup } from "@creact-labs/creact";
import http from "node:http";
import crypto from "node:crypto";
import type { PullRequestEvent } from "../types/index";

interface ChannelProps {
  port: number;
  webhookSecret: string;
  onPullRequest: (event: PullRequestEvent) => void;
}

export function Channel(props: ChannelProps) {
    let server: http.Server;

    onMount(() => {
      server = http.createServer((req, res) => {
        if (req.method !== "POST" || req.url !== "/webhook") {
          res.writeHead(404);
          res.end("Not found");
          return;
        }

        let body = "";
        req.on("data", (chunk: Buffer) => {
          body += chunk.toString();
        });

        req.on("end", () => {
          // ── Signature Verification ──────────────────────────────────────
          // GitHub sends an X-Hub-Signature-256 header. We compute our own
          // HMAC and compare. If they don't match, we reject the request.
          // This prevents spoofed webhook calls.
          const signature = req.headers["x-hub-signature-256"] as string;
          if (!verifySignature(body, props.webhookSecret, signature)) {
            console.warn(
              "[Channel] ⚠️  Rejected webhook — invalid signature"
            );
            res.writeHead(401);
            res.end("Unauthorized");
            return;
          }

          const event = req.headers["x-github-event"] as string;

          // We only care about pull_request events — ignore everything else
          if (event !== "pull_request") {
            res.writeHead(200);
            res.end("OK (ignored)");
            return;
          }

          try {
            const payload = JSON.parse(body);
            const action: string = payload.action;

            // We care about: opened, synchronize (new commits pushed),
            // reopened. We skip: closed, labeled, assigned, etc.
            if (!["opened", "synchronize", "reopened"].includes(action)) {
              res.writeHead(200);
              res.end(`OK (action "${action}" not tracked)`);
              return;
            }

            const pr = payload.pull_request;
            const repo: string = payload.repository.full_name;

            const prEvent: PullRequestEvent = {
              id: pr.id,
              number: pr.number,
              title: pr.title,
              author: pr.user.login,
              body: pr.body ?? null,
              repo,
              baseBranch: pr.base.ref,
              headBranch: pr.head.ref,
              diffUrl: pr.diff_url,
              htmlUrl: pr.html_url,
              // additions + deletions gives total lines touched
              changedLines: (pr.additions ?? 0) + (pr.deletions ?? 0),
              createdAt: pr.created_at,
            };

            console.log(
              `[Channel] 📬 PR #${prEvent.number} received — "${prEvent.title}" by @${prEvent.author} (${prEvent.changedLines} lines changed)`
            );

            // Emit into CReact's reactive graph — this updates the signal
            // in App, which triggers the For/Show reconciliation
            props.onPullRequest(prEvent);

            res.writeHead(200);
            res.end("OK");
          } catch (err) {
            console.error("[Channel] ❌ Failed to parse webhook payload:", err);
            res.writeHead(400);
            res.end("Bad request");
          }
        });
      });

      server.listen(props.port, () => {
        console.log(
          `[Channel] 🚀 Webhook server listening on http://localhost:${props.port}/webhook`
        );
      });
    });

    // CReact calls onCleanup when the component unmounts.
    // We close the HTTP server so ports are released on restart —
    // critical for durable restart-safe behavior.
    onCleanup(() => {
      if (server) {
        server.close();
        console.log("[Channel] 🛑 Webhook server closed");
      }
    });

    return null;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function verifySignature(
  payload: string,
  secret: string,
  signature: string | undefined
): boolean {
  if (!signature) return false;
  const expected = `sha256=${crypto
    .createHmac("sha256", secret)
    .update(payload)
    .digest("hex")}`;
  // timingSafeEqual prevents timing attacks
  try {
    return crypto.timingSafeEqual(
      Buffer.from(signature),
      Buffer.from(expected)
    );
  } catch {
    return false;
  }
}
