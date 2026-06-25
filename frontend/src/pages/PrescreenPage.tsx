import { useEffect, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { api, type PrescreenQuestion } from "@/lib/api";

export function PrescreenPage() {
  const { code } = useParams<{ code: string }>();
  const [searchParams] = useSearchParams();
  const autoCheckIn = searchParams.get("autoCheckIn") === "1";
  const priority = searchParams.get("priority") === "1";

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [firstName, setFirstName] = useState("");
  const [questions, setQuestions] = useState<PrescreenQuestion[]>([]);
  const [responses, setResponses] = useState<Record<string, boolean | null>>({});
  const [alreadyDone, setAlreadyDone] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [queueNumber, setQueueNumber] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!code) {
      setError("Invalid link. No appointment code found.");
      setLoading(false);
      return;
    }
    api
      .prescreenLoad(code)
      .then((data) => {
        setFirstName(data.firstName);
        if (data.prescreenCompleted) {
          setAlreadyDone(true);
        } else if (data.questions.length === 0) {
          setAlreadyDone(true);
        } else {
          setQuestions(data.questions);
          const initial: Record<string, boolean | null> = {};
          for (const q of data.questions) initial[String(q.id)] = null;
          setResponses(initial);
        }
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : "Appointment not found.");
      })
      .finally(() => setLoading(false));
  }, [code]);

  async function submit() {
    const allAnswered = Object.values(responses).every((v) => v !== null);
    if (!allAnswered) {
      alert("Please answer all questions before submitting.");
      return;
    }
    setSubmitting(true);
    try {
      const cleanResponses: Record<string, boolean> = {};
      for (const [k, v] of Object.entries(responses)) {
        cleanResponses[k] = v as boolean;
      }
      const res = await api.prescreenSubmit(code!, cleanResponses, autoCheckIn, priority);
      if (res.ok) {
        setSubmitted(true);
        if (res.checkedIn && res.queueNumber) {
          setQueueNumber(res.queueNumber);
        }
      }
    } catch (err) {
      alert(err instanceof Error ? err.message : "Server error. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen bg-[#f5f5f5] p-4">
      <div className="mx-auto max-w-[500px]">
        <div className="rounded-t-xl bg-civic-800 px-6 py-5 text-center text-white">
          <h1 className="text-lg font-bold">St. Lucie County Tax Collector</h1>
          <p className="text-sm opacity-80">Pre-Screen Questions</p>
        </div>

        <div className="rounded-b-xl bg-white p-6 shadow-md">
          {loading && (
            <p className="text-center text-sm text-gray-500">Loading…</p>
          )}

          {error && (
            <div className="text-center py-8">
              <p className="text-red-600">{error}</p>
            </div>
          )}

          {alreadyDone && !error && (
            <div className="text-center py-8">
              <h2 className="text-xl font-bold text-go-700">Already Completed</h2>
              <p className="mt-2 text-sm text-gray-500">
                Your pre-screen questions have already been submitted. You're all set!
              </p>
            </div>
          )}

          {submitted && (
            <div className="text-center py-8">
              <div className="text-4xl mb-3">✓</div>
              <h2 className="text-xl font-bold text-go-700">Pre-Screen Complete!</h2>
              {queueNumber ? (
                <>
                  <p className="mt-3 text-base font-bold text-ink">
                    You're checked in — your place in the queue:
                  </p>
                  <p className="mt-2 text-6xl font-extrabold text-civic-600">{queueNumber}</p>
                  <p className="mt-3 text-sm text-gray-500">
                    Please have a seat. You'll be called when it's your turn.
                  </p>
                </>
              ) : (
                <p className="mt-2 text-sm text-gray-500">
                  Thank you. Your answers have been submitted. You can close this page.
                </p>
              )}
            </div>
          )}

          {!loading && !error && !alreadyDone && !submitted && (
            <>
              <p className="mb-4 text-sm text-gray-700">
                Hi <strong>{firstName}</strong>, please answer the following questions before your
                appointment.
              </p>

              <div className="space-y-4">
                {questions.map((q, i) => (
                  <div key={q.id} className="border-b border-gray-100 pb-4 last:border-0">
                    <div className="flex gap-3">
                      <span className="text-xs font-bold text-civic-500">{i + 1}.</span>
                      <div className="flex-1">
                        <p className="text-sm text-gray-800">{q.questionText}</p>
                        <div className="mt-2 flex gap-4">
                          <label className="flex items-center gap-1.5 text-sm cursor-pointer">
                            <input
                              type="radio"
                              name={`q_${q.id}`}
                              checked={responses[String(q.id)] === true}
                              onChange={() =>
                                setResponses((prev) => ({ ...prev, [String(q.id)]: true }))
                              }
                            />
                            Yes
                          </label>
                          <label className="flex items-center gap-1.5 text-sm cursor-pointer">
                            <input
                              type="radio"
                              name={`q_${q.id}`}
                              checked={responses[String(q.id)] === false}
                              onChange={() =>
                                setResponses((prev) => ({ ...prev, [String(q.id)]: false }))
                              }
                            />
                            No
                          </label>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              <button
                onClick={submit}
                disabled={submitting}
                className="mt-5 w-full rounded-lg bg-civic-500 px-4 py-3 text-sm font-semibold text-white transition-colors hover:bg-civic-600 disabled:bg-gray-400 disabled:cursor-not-allowed"
              >
                {submitting ? "Submitting…" : "Submit Answers"}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
