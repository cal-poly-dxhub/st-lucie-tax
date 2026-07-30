import { useState } from "react";
import { Badge, Button, Table, TBody, TD, TEmpty, TH, THead, TR } from "@st-lucie/ui";
import {
  approveDecisionTree,
  deleteDecisionTree,
  fetchDecisionTree,
  fetchDecisionTrees,
  uploadDecisionTree,
  type DecisionTreeDetail,
  type DecisionTreeRow,
} from "@/config-api";
import { useResource } from "./use-resource";
import { ErrorBanner, Section, Spinner } from "./parts";

function statusTone(status: string): "go" | "warn" | "neutral" {
  switch (status) {
    case "approved":
      return "go";
    case "draft":
      return "warn";
    default:
      return "neutral";
  }
}

export function DecisionTreesPage() {
  const { data, error, loading, saving, mutate } =
    useResource<DecisionTreeRow[]>(fetchDecisionTrees);

  const [uploadTreeId, setUploadTreeId] = useState("");
  const [uploadContent, setUploadContent] = useState("");
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [viewDetail, setViewDetail] = useState<DecisionTreeDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  async function handleUpload() {
    setUploadError(null);
    try {
      const parsed = JSON.parse(uploadContent);
      const treeId = uploadTreeId.trim() || parsed.txnTypeId;
      if (!treeId) {
        setUploadError("Tree ID is required (either in the field or as txnTypeId in the JSON).");
        return;
      }
      const ok = await mutate(
        () => uploadDecisionTree({ treeId, content: parsed }),
        "Decision tree uploaded as draft.",
      );
      if (ok) {
        setUploadTreeId("");
        setUploadContent("");
      }
    } catch (e) {
      setUploadError(e instanceof Error ? e.message : "Invalid JSON");
    }
  }

  async function handleApprove(id: number) {
    await mutate(() => approveDecisionTree(id), "Decision tree approved.");
  }

  async function handleDelete(id: number) {
    await mutate(() => deleteDecisionTree(id), "Decision tree deleted.");
  }

  async function viewTree(id: number) {
    setDetailLoading(true);
    try {
      const detail = await fetchDecisionTree(id);
      setViewDetail(detail);
    } catch {
      // Ignore
    } finally {
      setDetailLoading(false);
    }
  }

  if (error) return <ErrorBanner>{error}</ErrorBanner>;
  if (loading && !data) return <Spinner />;

  const rows = data ?? [];

  // Group by tree_id for cleaner display
  const treeIds = [...new Set(rows.map((r) => r.tree_id))].sort();

  return (
    <div className="flex flex-col gap-5">
      <Section
        title="Decision trees"
        description="Upload JSON decision trees used by the chatbot to determine required documents. Trees go through a draft → approved workflow. Only approved trees are used by the chatbot."
      >
        <Table>
          <THead>
            <TR className="hover:bg-transparent">
              <TH>Tree ID</TH>
              <TH className="w-16">Ver</TH>
              <TH className="w-24">Status</TH>
              <TH className="w-40">Created by</TH>
              <TH className="w-36">Created at</TH>
              <TH align="right" className="w-48" />
            </TR>
          </THead>
          <TBody>
            {rows.length === 0 ? (
              <TEmpty colSpan={6}>
                No decision trees in the database yet. Trees are loaded from the filesystem by default.
              </TEmpty>
            ) : (
              rows.map((r) => (
                <TR key={r.id}>
                  <TD className="font-mono text-xs">{r.tree_id}</TD>
                  <TD className="text-center text-xs">v{r.version}</TD>
                  <TD>
                    <Badge tone={statusTone(r.status)}>{r.status}</Badge>
                  </TD>
                  <TD className="text-xs text-civic-500">{r.created_by}</TD>
                  <TD className="text-xs text-civic-500">
                    {new Date(r.created_at).toLocaleDateString()}
                  </TD>
                  <TD align="right">
                    <span className="inline-flex items-center gap-1">
                      <Button
                        variant="outline"
                        className="px-2 py-1 text-xs"
                        onClick={() => viewTree(r.id)}
                      >
                        View
                      </Button>
                      {r.status === "draft" && (
                        <>
                          <Button
                            variant="go"
                            className="px-2 py-1 text-xs"
                            loading={saving}
                            onClick={() => handleApprove(r.id)}
                          >
                            Approve
                          </Button>
                          <Button
                            variant="outline"
                            className="px-2 py-1 text-xs text-stop-600"
                            loading={saving}
                            onClick={() => handleDelete(r.id)}
                          >
                            Delete
                          </Button>
                        </>
                      )}
                    </span>
                  </TD>
                </TR>
              ))
            )}
          </TBody>
        </Table>

        <p className="mt-2 text-xs text-civic-400">
          {treeIds.length} unique tree IDs across {rows.length} versions
        </p>
      </Section>

      {/* Upload section */}
      <Section
        title="Upload new tree"
        description="Paste a decision-tree JSON file. It will be saved as a draft until approved."
      >
        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-xs font-semibold text-civic-600" htmlFor="tree-id">
              Tree ID (txnTypeId)
            </label>
            <input
              id="tree-id"
              type="text"
              value={uploadTreeId}
              onChange={(e) => setUploadTreeId(e.target.value)}
              placeholder="e.g. vehicle-registration (auto-detected from JSON if empty)"
              className="w-full rounded-lg border border-civic-200 px-3 py-2 text-sm focus:border-civic-500 focus:outline-none"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-civic-600" htmlFor="tree-json">
              JSON content
            </label>
            <textarea
              id="tree-json"
              value={uploadContent}
              onChange={(e) => setUploadContent(e.target.value)}
              placeholder='{"txnTypeId": "...", "baseItems": [...], "factsRequired": [...], "branches": [...], "sources": {...}}'
              rows={10}
              className="w-full rounded-lg border border-civic-200 px-3 py-2 font-mono text-xs focus:border-civic-500 focus:outline-none"
            />
          </div>
          {uploadError && (
            <p className="text-sm text-stop-600">{uploadError}</p>
          )}
          <Button
            loading={saving}
            disabled={!uploadContent.trim()}
            onClick={handleUpload}
          >
            Upload as draft
          </Button>
        </div>
      </Section>

      {/* Detail view modal */}
      {viewDetail && (
        <Section
          title={`Tree: ${viewDetail.tree_id} v${viewDetail.version}`}
          description={`Status: ${viewDetail.status} | Created by: ${viewDetail.created_by}`}
          actions={
            <Button variant="outline" onClick={() => setViewDetail(null)}>
              Close
            </Button>
          }
        >
          <pre className="max-h-96 overflow-auto rounded-lg bg-civic-50 p-4 font-mono text-xs text-civic-700">
            {JSON.stringify(viewDetail.content, null, 2)}
          </pre>
        </Section>
      )}

      {detailLoading && <Spinner />}
    </div>
  );
}
