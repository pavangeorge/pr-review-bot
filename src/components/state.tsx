// ─────────────────────────────────────────────────────────────────────────────
// State — Durable Review Record Persistence
//
// useAsyncOutput is the correct primitive here. From the CReact docs:
//
//   "Only values passed to setOutputs() are persisted. Regular signals,
//    effects, and local variables are not saved."
//
// This means a plain createSignal() would reset to [] on every restart —
// defeating the entire durability guarantee. useAsyncOutput persists its
// output values through the FileMemory backend, so on restart CReact
// restores prev.reviews to exactly what it was before the process stopped.
//
// The pattern:
//   setOutputs(prev => ...)  — read previous state, write new state
//   counter.reviews()        — reactive accessor for the current value
// ─────────────────────────────────────────────────────────────────────────────

import { useAsyncOutput, createEffect } from '@creact-labs/creact';
import type { ReviewRecord } from '../types/index';

// Module-level reference so other components can call isReviewed/recordReview
// without needing to re-instantiate the hook.
let _setOutputs: ((fn: (prev: any) => any) => void) | null = null;
let _reviews: (() => ReviewRecord[]) | null = null;

export function StateManager() {
  const state = useAsyncOutput({}, async (_props, setOutputs) => {
    // On restart: prev.reviews holds every review recorded before the process
    // stopped. On first run: prev is null, so we default to empty array.
    setOutputs(prev => ({
      reviews: prev?.reviews ?? [] as ReviewRecord[],
    }));

    // Expose setter to module scope so recordReview() can call it
    _setOutputs = setOutputs;

    // Cleanup: nothing async to tear down
    return () => {
      _setOutputs = null;
      _reviews = null;
    };
  });

  // Expose reactive accessor to module scope
  _reviews = () => (state.reviews() ?? []) as ReviewRecord[];

  createEffect(() => {
    const count = (state.reviews() as ReviewRecord[] ?? []).length;
    console.log(`[State] 💾 ${count} review(s) in persistent store`);
  });

  return <></>;
}

/**
 * Checks if a PR has already been reviewed.
 * Powers the <Show when={() => !isReviewed(pr.id)}> guard in App.
 */
export function isReviewed(prId: number): boolean {
  if (!_reviews) return false;
  return (_reviews() ?? []).some((r: ReviewRecord) => r.prId === prId);
}

/**
 * Records a completed review durably.
 * setOutputs() writes through to FileMemory — survives restarts.
 */
export function recordReview(record: ReviewRecord): void {
  if (!_setOutputs) {
    console.warn('[State] ⚠️  setOutputs not ready — review not persisted');
    return;
  }
  _setOutputs(prev => ({
    reviews: [...(prev?.reviews ?? []), record],
  }));
  console.log(
    `[State] ✅ Persisted review for PR #${record.prNumber} (${record.repo})`
  );
}

/**
 * Returns full review history — used by the dashboard.
 */
export function getReviewHistory(): ReviewRecord[] {
  if (!_reviews) return [];
  return _reviews() ?? [];
}