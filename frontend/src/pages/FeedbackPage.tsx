import { useState } from "react";
import { Button, Card, useToast } from "@st-lucie/ui";
import { api } from "@/lib/api";

export function FeedbackPage() {
  const notify = useToast();
  const [name, setName] = useState("");
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!message.trim()) {
      notify("error", "Please enter a message.");
      return;
    }
    setSubmitting(true);
    try {
      await api.submitFeedback({ name: name.trim() || undefined, message: message.trim() });
      notify("success", "Thanks for your feedback!");
      setName("");
      setMessage("");
    } catch (err: unknown) {
      notify("error", err instanceof Error ? err.message : "Failed to submit feedback.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="mx-auto max-w-xl px-4 py-10">
      <h1 className="font-display text-2xl font-bold text-ink">Feedback</h1>
      <p className="mt-1 text-sm text-civic-500">
        Share your thoughts, suggestions, or report issues.
      </p>

      <Card className="mt-6 p-6">
        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <label htmlFor="feedback-name" className="block text-sm font-semibold text-ink">
              Name <span className="font-normal text-civic-400">(optional)</span>
            </label>
            <input
              id="feedback-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Your name (optional)"
              className="mt-1.5 w-full rounded-lg border border-civic-200 px-3 py-2 text-sm text-ink placeholder:text-civic-300 focus:border-civic-400 focus:outline-none focus:ring-2 focus:ring-civic-200"
            />
          </div>

          <div>
            <label htmlFor="feedback-message" className="block text-sm font-semibold text-ink">
              Message <span className="text-stop-500">*</span>
            </label>
            <textarea
              id="feedback-message"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Share your feedback…"
              rows={5}
              required
              className="mt-1.5 w-full rounded-lg border border-civic-200 px-3 py-2 text-sm text-ink placeholder:text-civic-300 focus:border-civic-400 focus:outline-none focus:ring-2 focus:ring-civic-200"
            />
          </div>

          <Button type="submit" loading={submitting}>
            Submit Feedback
          </Button>
        </form>
      </Card>
    </div>
  );
}
