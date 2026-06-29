/**
 * Inline comment form for a single assistant message — appears beneath the
 * bubble when the user clicks "Write Comment". Matches the OcrConfirmation
 * card pattern (no portal, no overlay).
 */
import { useState } from 'react';

interface Props {
  initialValue?: string;
  onSubmit: (comment: string) => void;
  onCancel: () => void;
  pending?: boolean;
}

export function MessageCommentForm({ initialValue = '', onSubmit, onCancel, pending = false }: Props) {
  const [value, setValue] = useState(initialValue);
  const trimmed = value.trim();

  return (
    <div className="message-comment-form">
      <textarea
        className="message-comment-textarea"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="What about this response was helpful, confusing, or wrong?"
        rows={3}
        autoFocus
      />
      <div className="message-comment-actions">
        <button type="button" className="message-comment-cancel" onClick={onCancel} disabled={pending}>
          Cancel
        </button>
        <button
          type="button"
          className="message-comment-submit"
          disabled={pending || trimmed.length === 0}
          onClick={() => onSubmit(trimmed)}
        >
          {pending ? 'Submitting…' : 'Submit'}
        </button>
      </div>
    </div>
  );
}
