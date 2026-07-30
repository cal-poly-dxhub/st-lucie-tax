/**
 * File upload component for DL photos and documents.
 *
 * After a successful S3 upload the file is screened by a synchronous AI
 * pass/reject check (validateDocument). The screen is conservative + fail-open:
 * only an explicit reject blocks the upload from counting as complete. A reject
 * shows a friendly reason and lets the resident re-pick a file (retry) — it is
 * advisory, never a hard wall (they can still skip / bring it to the office).
 */

import { useState, useRef } from "react";
import { getUploadUrl, uploadToS3, validateDocument } from "../api";

interface Props {
  sessionId: string;
  documentType: string;
  label: string;
  accept?: string;
  onUploaded: (s3Key: string, fingerprint: string) => void;
  /**
   * Optional cross-slot duplicate guard. Given the file about to be uploaded,
   * returns true iff ANOTHER slot CURRENTLY holds this exact file. "Currently"
   * is the key word: it reflects what's in the other slots right now, so
   * re-uploading (replacing) a slot's file never leaves a stale match, and a
   * rejected/re-tried upload never falsely triggers it.
   */
  isDuplicate?: (fingerprint: string) => boolean;
}

/** Lightweight client-side file identity (name + size + mtime) — enough to
 *  catch "the exact same file in two slots" without hashing bytes. */
function fileFingerprint(f: File): string {
  return `${f.name}|${f.size}|${f.lastModified}`;
}

type Status = "idle" | "uploading" | "validating" | "done" | "rejected" | "error";

export function FileUpload({
  sessionId,
  documentType,
  label,
  accept,
  onUploaded,
  isDuplicate,
}: Props) {
  const [status, setStatus] = useState<Status>("idle");
  const [fileName, setFileName] = useState("");
  const [rejectReason, setRejectReason] = useState("");
  const [advisory, setAdvisory] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Block ONLY the exact same file that another proof slot currently holds.
    // Checked live against current slot contents (not a running history), so
    // re-picking a file after a reject or replacing a slot never false-triggers.
    const fingerprint = fileFingerprint(file);
    if (isDuplicate?.(fingerprint)) {
      setAdvisory("");
      setFileName(file.name);
      setRejectReason(
        "That's the same file you just used for the other proof. Each proof of address must come from a different source (e.g. a utility bill AND a bank statement).",
      );
      setStatus("rejected");
      if (inputRef.current) inputRef.current.value = "";
      return;
    }

    setRejectReason("");
    setFileName(file.name);
    setStatus("uploading");

    try {
      const { uploadUrl, s3Key } = await getUploadUrl(sessionId, documentType, file.name);
      await uploadToS3(uploadUrl, file);

      // Synchronous AI screen. Fail-open inside validateDocument, so this only
      // returns 'reject' on a confident, obviously-wrong image.
      setStatus("validating");
      const verdict = await validateDocument(sessionId, documentType, s3Key, file.name);

      if (verdict.verdict === "reject") {
        setRejectReason(
          verdict.reason ||
            "That doesn't look like the right document. You can re-upload, or bring it to the office.",
        );
        setStatus("rejected");
        // Clear the input so re-picking the SAME file still fires onChange.
        if (inputRef.current) inputRef.current.value = "";
        return; // do NOT call onUploaded — this slot stays incomplete.
      }

      // Accepted. A content/status check may still attach a non-blocking
      // advisory — show it, but the slot completes normally either way.
      if (verdict.advisory) setAdvisory(verdict.advisory);
      setStatus("done");
      onUploaded(s3Key, fingerprint);
    } catch (err) {
      console.error("Upload failed:", err);
      setStatus("error");
    }
  };

  return (
    <div className="file-upload">
      <input
        ref={inputRef}
        type="file"
        accept={accept || "image/*,.pdf"}
        onChange={handleFile}
        style={{ display: "none" }}
      />
      <button
        className="upload-btn"
        onClick={() => inputRef.current?.click()}
        disabled={status === "uploading" || status === "validating"}
      >
        {status === "idle" && label}
        {status === "uploading" && "Uploading..."}
        {status === "validating" && "Checking..."}
        {status === "done" && `Uploaded: ${fileName}`}
        {status === "rejected" && `Try another file: ${label}`}
        {status === "error" && "Upload failed — try again"}
      </button>
      {status === "rejected" && rejectReason && (
        <p className="file-upload-reject">{rejectReason}</p>
      )}
      {status === "done" && advisory && <p className="file-upload-advisory">{advisory}</p>}
    </div>
  );
}
