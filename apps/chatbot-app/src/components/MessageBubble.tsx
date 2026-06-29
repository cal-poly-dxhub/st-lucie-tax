import { useState } from 'react';
import type { Message, MessageFeedbackEntry } from '../hooks/useSession';
import type { KBSource } from '../api';
import { MessageCommentForm } from './MessageCommentForm';

interface MessageBubbleProps {
  message: Message;
  feedback?: MessageFeedbackEntry;
  onReact?: (reaction: 'good' | 'bad') => void | Promise<void>;
  onSubmitComment?: (comment: string) => void | Promise<void>;
}

export function MessageBubble({ message, feedback, onReact, onSubmitComment }: MessageBubbleProps) {
  const sources = message.kbSources || [];
  const [commentOpen, setCommentOpen] = useState(false);
  const [pending, setPending] = useState<null | 'good' | 'bad' | 'comment'>(null);

  const showFeedback = message.role === 'assistant' && (!!onReact || !!onSubmitComment);
  const goodSelected = feedback?.reaction === 'good';
  const badSelected = feedback?.reaction === 'bad';
  const hasComment = !!feedback?.comment;

  const handleReact = async (reaction: 'good' | 'bad') => {
    if (!onReact || pending) return;
    setPending(reaction);
    try {
      await onReact(reaction);
    } finally {
      setPending(null);
    }
  };

  const handleSubmitComment = async (comment: string) => {
    if (!onSubmitComment) return;
    setPending('comment');
    try {
      await onSubmitComment(comment);
      setCommentOpen(false);
    } finally {
      setPending(null);
    }
  };

  return (
    <div className={`message ${message.role}`}>
      <div className="message-content">
        {renderContent(message.content, sources)}
      </div>
      {showFeedback && (
        <div className="message-feedback">
          <button
            type="button"
            className={`message-feedback-btn${goodSelected ? ' message-feedback-btn--selected-good' : ''}`}
            disabled={pending !== null}
            onClick={() => handleReact('good')}
            aria-pressed={goodSelected}
          >
            {goodSelected ? '✓ Good' : 'Good Response'}
          </button>
          <button
            type="button"
            className={`message-feedback-btn${badSelected ? ' message-feedback-btn--selected-bad' : ''}`}
            disabled={pending !== null}
            onClick={() => handleReact('bad')}
            aria-pressed={badSelected}
          >
            {badSelected ? '✓ Bad' : 'Bad Response'}
          </button>
          <button
            type="button"
            className={`message-feedback-btn${hasComment ? ' message-feedback-btn--selected-comment' : ''}`}
            disabled={pending !== null}
            onClick={() => setCommentOpen(v => !v)}
            aria-expanded={commentOpen}
          >
            {hasComment ? '✓ Comment' : 'Write Comment'}
          </button>
        </div>
      )}
      {showFeedback && commentOpen && (
        <MessageCommentForm
          initialValue={feedback?.comment ?? ''}
          onSubmit={handleSubmitComment}
          onCancel={() => setCommentOpen(false)}
          pending={pending === 'comment'}
        />
      )}
    </div>
  );
}

/**
 * Pre-process text to normalize bullet point formats before rendering.
 * Handles: mid-line bullets (• item • item), numbered lists, markdown lists.
 */
function normalizeText(text: string): string {
  // Split mid-line bullet characters onto separate lines
  // Match: "• text" that appears after another bullet on the same line
  let result = text.replace(/ • /g, '\n- ');
  // Also handle leading • at start of line
  result = result.replace(/^• /gm, '- ');
  // Handle ✓ or ✅ mid-line
  result = result.replace(/ ✅ /g, '\n✅ ');
  result = result.replace(/ ✓ /g, '\n✓ ');
  return result;
}

function renderContent(text: string, sources: KBSource[]): React.ReactNode {
  const normalized = normalizeText(text);
  const lines = normalized.split('\n');

  return lines.map((line, i) => {
    const isLast = i === lines.length - 1;
    const trimmed = line.trimStart();

    // Headings: ## or ### -> bold block
    if (trimmed.startsWith('## ') || trimmed.startsWith('### ')) {
      return (
        <span key={i}>
          <strong className="md-heading">{formatInline(trimmed.replace(/^#{2,4}\s+/, ''))}</strong>
          <br />
        </span>
      );
    }

    // List items: - text, * text, or • text
    if (trimmed.startsWith('- ') || trimmed.startsWith('* ') || trimmed.startsWith('\u2022 ')) {
      const content = trimmed.replace(/^[-*\u2022]\s+/, '');
      return (
        <span key={i} className="md-list-item">
          {'\u2022 '}{formatInline(content)}
          <br />
        </span>
      );
    }

    // Checkbox-style: ✓ or ✅
    if (trimmed.startsWith('\u2713') || trimmed.startsWith('\u2705')) {
      return (
        <span key={i}>
          {formatInline(line)}
          <br />
        </span>
      );
    }

    // Empty line -> small gap
    if (!trimmed) {
      return <br key={i} />;
    }

    // Regular line with optional citations on the last line
    return (
      <span key={i}>
        {formatInline(line)}
        {isLast && sources.length > 0 && (
          <>
            {' '}
            {sources.map((source, si) =>
              source.url ? (
                <a
                  key={si}
                  href={source.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="cite-tick"
                  title={source.title}
                >
                  [{si + 1}]
                </a>
              ) : (
                <span key={si} className="cite-tick cite-tick--unlinked" title={source.title}>
                  [{si + 1}]
                </span>
              ),
            )}
          </>
        )}
        {!isLast && <br />}
      </span>
    );
  });
}

/** Format inline markdown: **bold** */
function formatInline(text: string): React.ReactNode {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={i}>{part.slice(2, -2)}</strong>;
    }
    return part;
  });
}

export function TypingIndicator() {
  return (
    <div className="typing-indicator">
      <div className="dot" />
      <div className="dot" />
      <div className="dot" />
    </div>
  );
}
