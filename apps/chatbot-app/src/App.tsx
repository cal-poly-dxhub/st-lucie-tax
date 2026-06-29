/**
 * Chatbot App — main component.
 * React SPA with chat UI, hot buttons, file uploads, session polling,
 * and walk-in kiosk mode.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import {
  createSession, fetchHotButtons, sendMessage, getSessionState, submitMessageFeedback,
  skipVerifyIdentity,
  loadBetaAuth, clearBetaAuth, type BetaAuthState,
  type HotButton, type SessionContext,
} from './api';
import { LoginPage } from './components/LoginPage';
import { useSession } from './hooks/useSession';
import { usePolling } from './hooks/usePolling';
import { MessageBubble, TypingIndicator } from './components/MessageBubble';
import { SmartQuickReplies } from './components/SmartQuickReplies';
import { ChatInput } from './components/ChatInput';
import { SidePanel } from './components/SidePanel';
import { DebugPanel } from './components/DebugPanel';
import { FileUpload } from './components/FileUpload';
import { AuthIdProof } from './components/AuthIdProof';
import { SchedulePanel } from './components/SchedulePanel';
import { ConfirmFacts } from './components/ConfirmFacts';
import { SaveResumeHint, shouldShowSaveResumeHint } from './components/SaveResumeHint';
import { BetaBanner } from './components/BetaBanner';
import { useResizableWidth } from './hooks/useResizableWidth';

export default function App() {
  // Auth gate. When auth state is null (no token in localStorage), the
  // whole app is replaced with the login screen. Setting it via the
  // LoginPage's onLogin or clearing it via "Log out" toggles between
  // the gated UI and the chatbot UI.
  const [auth, setAuth] = useState<BetaAuthState | null>(() => loadBetaAuth());
  const [authNotice, setAuthNotice] = useState<string | null>(null);

  const { session, isLoading, setIsLoading, addUserMessage, updateFromResponse, updateState, reset, rehydrating, recordMessageFeedback, setGeneralFeedbackNotes } = useSession();
  // Surface the save-and-resume pill the first time a sessionId is assigned —
  // not on rehydrate (those users already know about the URL) or in walk-in mode
  // (kiosk-shared localStorage would skip every customer after the first).
  // Once dismissed, stays hidden via SaveResumeHint's localStorage flag.
  const [saveResumeDismissed, setSaveResumeDismissed] = useState(false);
  const saveResumeHintVisible = !saveResumeDismissed && shouldShowSaveResumeHint({
    sessionId: session.sessionId,
    rehydrating,
    isWalkIn: session.isWalkIn,
  });

  const handleMessageReact = useCallback(async (messageId: string, reaction: 'good' | 'bad') => {
    if (!session.sessionId) return;
    recordMessageFeedback(messageId, { reaction });
    try {
      await submitMessageFeedback(session.sessionId, messageId, reaction);
    } catch (err) {
      console.error('Failed to submit message feedback:', err);
    }
  }, [session.sessionId, recordMessageFeedback]);

  const handleMessageComment = useCallback(async (messageId: string, comment: string) => {
    if (!session.sessionId) return;
    recordMessageFeedback(messageId, { comment });
    try {
      await submitMessageFeedback(session.sessionId, messageId, 'comment', comment);
    } catch (err) {
      console.error('Failed to submit message comment:', err);
    }
  }, [session.sessionId, recordMessageFeedback]);
  const sidePanel = useResizableWidth(340, 'stlucie:sidePanelWidth', { min: 200, max: 600 });
  const debugPanel = useResizableWidth(620, 'stlucie:debugPanelWidth', { min: 320, max: 1100 });
  const [hotButtons, setHotButtons] = useState<HotButton[]>([]);
  const [authIdProof, setAuthIdProof] = useState<{ embedUrl: string; operationId: string; mode: 'proof' | 'verified' } | null>(null);
  // null = show the verify/skip gate; 'verify' = mount the widget; 'skipping' =
  // skip in flight (hide both gate and widget while the backend advances).
  const [verifyChoice, setVerifyChoice] = useState<'verify' | 'skipping' | null>(null);
  const [completedDocUploads, setCompletedDocUploads] = useState<Set<string>>(new Set());
  const [docUploadsReady, setDocUploadsReady] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Load hot buttons on mount
  useEffect(() => {
    fetchHotButtons().then(setHotButtons);
  }, []);

  // Auto-scroll to latest message
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [session.messages, isLoading, authIdProof]);

  // Poll for async updates (queue placement, etc.).
  const shouldPollGeneral = session.state === 'upload-docs';
  usePolling(session.sessionId, shouldPollGeneral, useCallback((state: string, context: SessionContext) => {
    updateState(state, context);
  }, [updateState]));

  // Detect when the bot has opened an AuthID Proof (or rehydrate has staged a
  // Verified). The session row carries `pendingAuthIdProof` — we read it via
  // /session-state. Re-fires on every new bot message so we catch the turn
  // where start_authid_proof ran (state stays 'verify-identity' across that
  // turn, so we can't key on state alone). The /authid-result handler clears
  // pendingAuthIdProof on completion, so this stops firing after success.
  useEffect(() => {
    if (session.state !== 'verify-identity' || !session.sessionId || authIdProof) return;
    getSessionState(session.sessionId).then((s) => {
      const p = (s as { pendingAuthIdProof?: { embedUrl: string; operationId: string; mode: 'proof' | 'verified' } }).pendingAuthIdProof;
      if (p) setAuthIdProof(p);
    }).catch(() => { /* ignore */ });
  }, [session.state, session.sessionId, authIdProof, session.messages.length]);

  // Reveal the upload cards whenever we're in upload-docs — regardless of HOW we
  // got here. The common entry is clicking "Confirm and continue" in the
  // ConfirmFacts card (upload-docs is NOT an autoGreet state, so no bot turn
  // fires and the handleSend path below never runs). Keying only on that path
  // left the cards hidden while the quick-action chips still showed — the
  // customer saw "Done uploading / Skip" but no upload widgets. The cards are
  // independently gated on optionalUploads.length > 0, so showing them as soon
  // as we enter the state is safe.
  useEffect(() => {
    if (session.state === 'upload-docs' && session.sessionId) setDocUploadsReady(true);
  }, [session.state, session.sessionId]);

  const handleSend = async (message: string) => {
    if (isLoading) return;
    setIsLoading(true);
    addUserMessage(message);

    try {
      let sid = session.sessionId;
      if (!sid) {
        const created = await createSession(
          session.isWalkIn ? 'walkin' : 'web',
          session.walkInLocationId || undefined,
        );
        sid = created.sessionId;
        if (created.hotButtons?.length) setHotButtons(created.hotButtons);
      }

      const data = await sendMessage(sid, message);
      updateFromResponse(data);

      // After a bot response in upload-docs, enable the upload card
      // (the first response handles conditional questions, subsequent ones present lists)
      if (data.state === 'upload-docs') {
        setDocUploadsReady(true);
      }
    } catch (err) {
      console.error('Send message failed:', err);
      updateFromResponse({
        sessionId: session.sessionId || '',
        message: "We hit a snag on our side — that one didn't go through. Try sending it again, and if it keeps happening, refresh the page or come back in a few minutes.",
        state: session.state,
        structuredContext: session.context || { transactions: [], documents: [], preScreening: { answers: {}, completedTxnTypes: [] } },
        identifiedTransactions: [],
        combinedDocuments: [],
        totalDurationMinutes: 0,
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleReset = () => {
    reset();
    setAuthIdProof(null);
    setVerifyChoice(null);
    setCompletedDocUploads(new Set());
    setDocUploadsReady(false);
    fetchHotButtons().then(setHotButtons);
  };

  // After the backend advances us out of verify-identity (verify success or
  // skip), reconcile state from the server. verify-identity now sits right
  // before confirm-facts, so we advance to confirm-facts optimistically; the
  // background getSessionState fetch is authoritative (it carries any facts
  // the AuthID overwrite changed + reopened questions). The greeting is
  // typically empty for confirm-facts (the review card is the UI), so we only
  // splice it when present.
  const advanceAfterVerify = (greeting?: string) => {
    const sid = session.sessionId;
    if (!sid) return;
    setAuthIdProof(null);
    setVerifyChoice(null);
    // Optimistic: advance state now, no round-trip.
    updateState('confirm-facts', session.context ?? undefined);
    if (greeting) {
      updateFromResponse({
        sessionId: sid,
        message: greeting,
        state: 'confirm-facts',
        structuredContext: session.context ?? ({} as SessionContext),
        identifiedTransactions: [],
        combinedDocuments: [],
        totalDurationMinutes: 0,
      });
    }
    // Reconcile the authoritative state + context (incl. overwritten facts).
    getSessionState(sid)
      .then((s) => updateState(s.state, s.structuredContext))
      .catch(() => { /* ignore */ });
  };

  // True when the user has at least one transaction identified and every one
  // is blocked (hard or conditional). Once we know the visit can't move forward,
  // the DL upload card is hidden and we surface a Reset CTA instead — there's
  // no point uploading a license photo if no transaction can use it.
  const ctxTxns = session.context?.transactions ?? [];
  const allBlocked =
    ctxTxns.length > 0 && ctxTxns.every(t => t.status === 'blocked');

  // On verify-identity we always show the verify/skip gate (so the customer can
  // proceed even if AuthID is unreachable). The bot pre-creates the AuthID
  // transaction on entry; `authIdProof` is set only when that succeeded, which
  // is what enables the "Verify Identity" button. "Skip For Now" always works.
  const onVerifyState =
    session.state === 'verify-identity' && !!session.sessionId && !allBlocked;
  const showVerifyGate = onVerifyState && verifyChoice === null;
  const verifyAvailable = authIdProof !== null;
  const showAuthIdProof = onVerifyState && verifyChoice === 'verify' && authIdProof !== null;
  const showBlockedReset = !!session.sessionId && allBlocked;
  // Only show upload card after the bot has had a chance to ask conditional questions
  // and present the document lists. The bot calls complete_document_upload or the user
  // interacts — until then, the upload card stays hidden so questions aren't overlapped.
  const showDocUpload = session.state === 'upload-docs' && session.sessionId && docUploadsReady;

  // Upload slots come straight from the server's resolve_decision_trees bucket
  // split. The `optional_upload` bucket is the authoritative list of items that
  // can be provided digitally; anything else in the tree is a bring-in or a
  // form (handled elsewhere in the UI).
  const optionalUploads = session.context?.resolvedBuckets?.optionalUploads ?? [];

  const handleLogout = useCallback(() => {
    clearBetaAuth();
    setAuth(null);
    setAuthNotice(null);
    reset();
  }, [reset]);

  // Auth gate: show login when no token is present.
  if (!auth) {
    return (
      <LoginPage
        onLogin={(state) => {
          setAuth(state);
          setAuthNotice(null);
        }}
        notice={authNotice ?? undefined}
      />
    );
  }

  return (
    <div className="app">
      {import.meta.env.VITE_BETA_BANNER === '1' && <BetaBanner />}
      <header className="app-header">
        <div className="app-header-brand">
          <div className="app-header-logo" aria-hidden>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 2L2 7l10 5 10-5-10-5z"/>
              <path d="M2 17l10 5 10-5"/>
              <path d="M2 12l10 5 10-5"/>
            </svg>
          </div>
          <div className="app-header-titles">
            <h1>St. Lucie County Tax Collector</h1>
            <p className="app-header-subtitle">
              {session.isWalkIn ? 'Walk-In Service' : 'AI-powered visit planner'}
            </p>
          </div>
        </div>
        <div className="app-header-status">
          <SessionBadge
            sessionId={session.sessionId}
            onNewSession={handleReset}
          />
          <span className="status-label">
            <span className="status-dot" aria-hidden />
            AI assistant online
          </span>
          <div className="auth-badge" title={auth.email}>
            <span className="auth-email">{auth.email}</span>
            <button
              type="button"
              className="auth-logout-btn"
              onClick={handleLogout}
              title="Sign out and clear local session"
            >
              Log out
            </button>
          </div>
        </div>
      </header>

      {saveResumeHintVisible && (
        <SaveResumeHint onDismiss={() => setSaveResumeDismissed(true)} />
      )}

      <div className="main-content">
        <div className="chat-panel">
          <div className="messages">
            {session.messages.length === 0 && (
              <div className="welcome-hero">
                <div className="welcome-hero-glow" aria-hidden />
                <div className="welcome-hero-content">
                  <div className="welcome-hero-eyebrow">St. Lucie County Tax Collector</div>
                  <h2>How can I help you today?</h2>
                  <p>
                    I can figure out exactly what you need, what documents to bring, and schedule
                    your visit — all before you leave your kitchen table. Tell me what you're here
                    for, or pick a common service below.
                  </p>
                </div>
              </div>
            )}

            {session.messages.map((msg) => (
              <MessageBubble
                key={msg.messageId}
                message={msg}
                feedback={session.messageFeedback[msg.messageId]}
                onReact={msg.role === 'assistant'
                  ? (reaction) => handleMessageReact(msg.messageId, reaction)
                  : undefined}
                onSubmitComment={msg.role === 'assistant'
                  ? (comment) => handleMessageComment(msg.messageId, comment)
                  : undefined}
              />
            ))}

            {isLoading && <TypingIndicator />}

            {/* When every active transaction is blocked, replace any upload
                or follow-up prompt with a single Reset CTA — there's no path
                forward in this session, so the only useful affordance is to
                start fresh. The old session row remains in DynamoDB for
                analytics. */}
            {showBlockedReset && !isLoading && (
              <div className="blocked-reset-prompt">
                <p className="blocked-reset-line">
                  We can't move forward with this visit based on your answers above.
                  When you're ready to try a different service or your situation changes,
                  start a new conversation.
                </p>
                <button
                  type="button"
                  className="blocked-reset-btn"
                  onClick={handleReset}
                >
                  Start a new conversation
                </button>
              </div>
            )}

            {/* Verify-identity gate: explain the benefit, let the customer
                choose to verify now or skip. Verify is enabled only when the
                AuthID transaction was created (verifyAvailable); Skip always
                works, so the customer can proceed even if AuthID is down. */}
            {showVerifyGate && !isLoading && (
              <div className="verify-gate">
                <p className="verify-gate-blurb">
                  {verifyAvailable
                    ? "Verifying your identity securely pre-fills your license details, so your visit is quicker and there's less to fill out at the counter. It's optional — you can skip and verify in person."
                    : "Online identity verification is temporarily unavailable. You can continue now and verify in person at the office."}
                </p>
                <div className="verify-gate-actions">
                  {verifyAvailable && (
                    <button
                      type="button"
                      className="verify-gate-btn verify-gate-btn--primary"
                      onClick={() => setVerifyChoice('verify')}
                    >
                      Verify Identity
                    </button>
                  )}
                  <button
                    type="button"
                    className="verify-gate-btn verify-gate-btn--secondary"
                    onClick={() => {
                      if (!session.sessionId) return;
                      setVerifyChoice('skipping'); // hide the gate; do NOT mount the widget
                      skipVerifyIdentity(session.sessionId)
                        .then((r) => advanceAfterVerify(r.greeting))
                        .catch(() => setVerifyChoice(null));
                    }}
                  >
                    {verifyAvailable ? 'Skip For Now' : 'Continue'}
                  </button>
                </div>
              </div>
            )}

            {/* AuthID Proof / Verified widget — mounted only after the customer
                chooses "Verify Identity" at the gate. */}
            {showAuthIdProof && !isLoading && authIdProof && (
              <AuthIdProof
                sessionId={session.sessionId!}
                embedUrl={authIdProof.embedUrl}
                mode={authIdProof.mode}
                onComplete={(outcome, reasons, greeting) => {
                  if (outcome === 'pass' || outcome === 'review') {
                    advanceAfterVerify(greeting);
                  } else {
                    console.warn('AuthID outcome:', outcome, reasons);
                    setAuthIdProof(null);
                  }
                }}
                onCancel={() => {
                  // User closed/declined the AuthID modal mid-flow. Tear down the
                  // overlay and proceed exactly as "Skip For Now".
                  if (!session.sessionId) { setAuthIdProof(null); setVerifyChoice(null); return; }
                  setAuthIdProof(null);
                  setVerifyChoice('skipping');
                  skipVerifyIdentity(session.sessionId)
                    .then((r) => advanceAfterVerify(r.greeting))
                    .catch(() => setVerifyChoice(null));
                }}
              />
            )}

            {/* Upload widgets + skip button for upload-docs state — one widget per
                item in the server-resolved optional_upload bucket. */}
            {showDocUpload && !isLoading && optionalUploads.length > 0 && (
              <div className="upload-prompt doc-uploads">
                <div className="doc-upload-header">
                  Digital upload OR bring to office ({completedDocUploads.size} of {optionalUploads.length} uploaded)
                </div>
                {optionalUploads.map(item => (
                  <FileUpload
                    key={item.itemId}
                    sessionId={session.sessionId!}
                    documentType={item.itemId}
                    label={completedDocUploads.has(item.itemId) ? `Uploaded: ${item.label}` : `Upload: ${item.label}`}
                    accept="image/*,.pdf"
                    onUploaded={() => {
                      setCompletedDocUploads(prev => new Set(prev).add(item.itemId));
                    }}
                  />
                ))}
                {completedDocUploads.size === optionalUploads.length && (
                  <button
                    className="doc-continue-btn"
                    onClick={() => handleSend('I have uploaded all my documents')}
                  >
                    All uploaded — Continue
                  </button>
                )}
                <button
                  className="doc-skip-btn"
                  onClick={() => handleSend("I'll bring everything to the office")}
                >
                  Skip — I'll bring everything to the office
                </button>
              </div>
            )}

            {/* Confirm-facts review card — customer reviews every fact before
                advancing to upload-docs + wrap-up. Lets them edit and opt into email. */}
            {session.state === 'confirm-facts' && session.sessionId && (
              <ConfirmFacts
                sessionId={session.sessionId}
                facts={session.context?.facts ?? {}}
                txnTypeIds={session.transactions.map(t => t.txnTypeId)}
                onConfirmed={(newState) => updateState(newState, session.context ?? undefined)}
                onFactsUpdated={(patch) => {
                  if (!session.context) return;
                  updateState(session.state, { ...session.context, ...patch });
                }}
              />
            )}

            {/* Scheduling card — offers the next available slot and books it.
                Hides once an appointment exists (confirmation renders in the
                side panel). */}
            {session.state === 'schedule' && session.sessionId && !session.context?.scheduling?.appointmentId && (
              <SchedulePanel
                sessionId={session.sessionId}
                defaultName={session.context?.identity?.name || undefined}
                onBooked={() => {
                  if (!session.sessionId) return;
                  getSessionState(session.sessionId)
                    .then((s) => updateState(s.state, s.structuredContext))
                    .catch(() => { /* ignore */ });
                }}
              />
            )}

            <div ref={messagesEndRef} />
          </div>

          <SmartQuickReplies
            session={session}
            hotButtons={hotButtons}
            onSelect={handleSend}
            disabled={isLoading}
          />

          <ChatInput
            onSend={handleSend}
            disabled={isLoading}
            placeholder={getPlaceholder(session.state)}
          />
        </div>

        <div
          className="drag-handle drag-handle--vertical"
          onPointerDown={sidePanel.startDrag}
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize side panel"
        />
        <div style={{ width: sidePanel.width, flex: '0 0 auto', display: 'flex', minWidth: 0 }}>
          <SidePanel session={session} onReset={handleReset} />
        </div>
        {import.meta.env.VITE_HIDE_DEBUG !== '1' && (
          <>
            <div
              className="drag-handle drag-handle--vertical"
              onPointerDown={debugPanel.startDrag}
              role="separator"
              aria-orientation="vertical"
              aria-label="Resize debug panel"
            />
            <div style={{ width: debugPanel.width, flex: '0 0 auto', display: 'flex', minWidth: 0 }}>
              <DebugPanel session={session} onNotesChange={setGeneralFeedbackNotes} />
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function getPlaceholder(state: string): string {
  switch (state) {
    case 'landing':
    case 'identify-transaction':
      return "Tell me what you're here for…";
    case 'universal-blockers':
      return "Type yes, no, or I'm not sure…";
    case 'verify-identity':
      return "Choose Verify Identity or Skip For Now above…";
    case 'resolve-facts':
      return "Answer the question above, or type a response…";
    case 'confirm-facts':
      return "Review your answers on the right, or ask a question…";
    case 'upload-docs':
      return "Upload a document, or type 'skip' to bring everything in person…";
    case 'checkout-check':
      return "Type 'online' or 'in person' to choose…";
    case 'schedule':
      return "Your visit plan is ready — anything else?";
    case 'confirm':
      return "Anything else I can help with?";
    default:
      return "Ask me anything, or describe what you need…";
  }
}

interface SessionBadgeProps {
  sessionId: string | null;
  onNewSession: () => void;
}

function SessionBadge({ sessionId, onNewSession }: SessionBadgeProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    if (!sessionId) return;
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard API can fail in some browsers/contexts — fall back silently.
    }
  };

  const truncated = sessionId ? `${sessionId.slice(0, 8)}…` : null;

  return (
    <div className="session-badge">
      {sessionId ? (
        <button
          className="session-id-chip"
          onClick={handleCopy}
          title={`Click to copy URL\nSession: ${sessionId}`}
          aria-label={`Session ${sessionId}. Click to copy URL.`}
        >
          <span className="session-id-label">session</span>
          <code className="session-id-value">{truncated}</code>
          {copied && <span className="session-id-copied">✓ copied</span>}
        </button>
      ) : (
        <span className="session-id-placeholder">no active session</span>
      )}
      <button
        className="new-session-btn"
        onClick={onNewSession}
        disabled={!sessionId}
        title="Start a new session"
      >
        New session
      </button>
    </div>
  );
}
