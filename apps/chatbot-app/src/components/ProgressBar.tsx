import { useEffect, useState } from "react";
import { fetchDebugTrees, type DebugTree } from "../api";
import type { SessionData } from "../hooks/useSession";

interface Props {
  session: SessionData;
}

export function ProgressBar({ session }: Props) {
  const [trees, setTrees] = useState<DebugTree[]>([]);
  const txnIds = session.transactions.map((t) => t.txnTypeId);
  const txnKey = txnIds.join(",");
  const facts = session.context?.facts ?? {};
  const state = session.state;

  useEffect(() => {
    if (!txnKey) {
      setTrees([]);
      return;
    }
    let cancelled = false;
    fetchDebugTrees(txnKey.split(","))
      .then((data) => {
        if (!cancelled) setTrees(data.trees);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [txnKey]);

  // Only show during resolve-facts (the question-answering phase)
  if (state !== "resolve-facts" || trees.length === 0) return null;

  // Compute cumulative progress across ALL active transaction trees
  const requiredKeys = new Set<string>();
  for (const tree of trees) {
    for (const fk of tree.factsRequired) requiredKeys.add(fk);
  }
  const total = requiredKeys.size;
  if (total === 0) return null;

  let resolved = 0;
  for (const fk of requiredKeys) {
    const fv = facts[fk];
    if (fv && fv.confidence !== "unknown") resolved++;
  }

  const pct = Math.round((resolved / total) * 100);

  return (
    <div
      className="progress-bar-container"
      aria-label={`Progress: ${resolved} of ${total} questions answered`}
    >
      <div className="progress-bar-track">
        <div className="progress-bar-fill" style={{ width: `${pct}%` }} />
      </div>
      <span className="progress-bar-label">
        {resolved}/{total} answered
      </span>
    </div>
  );
}
