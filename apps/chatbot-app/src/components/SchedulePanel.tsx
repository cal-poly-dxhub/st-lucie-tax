import { useEffect, useState } from 'react';
import {
  fetchSchedulingSlot,
  bookSchedulingAppointment,
  verifySchedulingEmail,
  checkSchedulingEmailStatus,
  type SchedulingSlotResponse,
  type SchedulingBookResponse,
} from '../api';

interface Props {
  sessionId: string;
  defaultName?: string;
  onBooked: () => void;
}

type Phase = 'loading' | 'offer' | 'contact' | 'verify-email' | 'verify-waiting' | 'booking' | 'unavailable' | 'done';

interface BookingConfirmation {
  confirmationCode: string;
  officeName: string;
  dateFormatted: string;
  timeFormatted: string;
  email: string;
}

export function SchedulePanel({ sessionId, defaultName, onBooked }: Props) {
  const [phase, setPhase] = useState<Phase>('loading');
  const [slot, setSlot] = useState<NonNullable<SchedulingSlotResponse['slot']>>();
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState(defaultName ?? '');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [emailVerified, setEmailVerified] = useState(false);
  const [confirmation, setConfirmation] = useState<BookingConfirmation | null>(null);

  function loadSlot() {
    setPhase('loading');
    setError(null);
    fetchSchedulingSlot(sessionId)
      .then((r) => {
        if (r.unavailable || r.schedulable === false || !r.slot) { setPhase('unavailable'); return; }
        setSlot(r.slot);
        setPhase('offer');
      })
      .catch((e: Error) => { setError(e.message); setPhase('unavailable'); });
  }

  useEffect(loadSlot, [sessionId]);

  async function handleVerifyEmail() {
    if (!email.trim()) { setError('Please enter your email.'); return; }
    setError(null);
    setPhase('verify-email');
    try {
      const result = await verifySchedulingEmail(sessionId, email.trim());
      if (result.status === 'already_verified') {
        setEmailVerified(true);
        setPhase('contact');
      } else {
        setPhase('verify-waiting');
      }
    } catch (e) {
      setError((e as Error).message);
      setPhase('contact');
    }
  }

  async function handleCheckVerification() {
    setError(null);
    try {
      const result = await checkSchedulingEmailStatus(sessionId, email.trim());
      if (result.verified) {
        setEmailVerified(true);
        setPhase('contact');
      } else {
        setError('Email not yet verified. Check your inbox for the AWS verification email and click the link.');
      }
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function confirmBooking() {
    if (!slot) return;
    if (!emailVerified) { handleVerifyEmail(); return; }
    const [firstName, ...rest] = name.trim().split(' ');
    const lastName = rest.join(' ') || firstName;
    setPhase('booking'); setError(null);
    try {
      const result = await bookSchedulingAppointment(sessionId, {
        officeId: slot.officeId, date: slot.date, time: slot.time,
        firstName, lastName, email: email.trim(), phone,
      });
      setConfirmation({
        confirmationCode: result.qrCode,
        officeName: result.officeName,
        dateFormatted: result.dateFormatted,
        timeFormatted: result.timeFormatted,
        email: email.trim(),
      });
      setPhase('done');
      onBooked();
    } catch (e) {
      const err = e as Error & { reason?: string };
      if (err.reason === 'slot-taken') { loadSlot(); return; }
      setError(err.message); setPhase('contact');
    }
  }

  if (phase === 'loading') return <div className="schedule-panel">Finding the next available time…</div>;
  if (phase === 'unavailable') return (
    <div className="schedule-panel">
      <p>Online scheduling isn't available for your transaction yet. Please call the office to book your visit.</p>
      {error && <p className="schedule-error">{error}</p>}
    </div>
  );

  if (phase === 'done' && confirmation) return (
    <div className="schedule-panel schedule-confirmation">
      <div className="schedule-confirmed-header">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
        <h3>Appointment Confirmed</h3>
      </div>
      <div className="schedule-confirmed-details">
        <p><strong>Confirmation Code:</strong> <span className="schedule-code">{confirmation.confirmationCode}</span></p>
        <p><strong>Date:</strong> {confirmation.dateFormatted}</p>
        <p><strong>Time:</strong> {confirmation.timeFormatted}</p>
        <p><strong>Location:</strong> {confirmation.officeName}</p>
      </div>
      <div className="schedule-qr">
        <img
          src={`https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=${encodeURIComponent(confirmation.confirmationCode)}`}
          alt="QR Code"
          width={150}
          height={150}
        />
        <p className="schedule-qr-hint">Present this QR code at check-in</p>
      </div>
      <p className="schedule-email-note">A confirmation email has been sent to {confirmation.email}.</p>
    </div>
  );

  return (
    <div className="schedule-panel" data-phase={phase}>
      {error && <div className="schedule-error" role="alert">{error}</div>}
      {slot && (
        <div className="schedule-offer">
          <h3>Next available</h3>
          <div className="schedule-offer-when">
            {slot.officeName} — {new Date(`${slot.date}T00:00:00`).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })} at {slot.time.slice(0, 5)}
          </div>
          {phase === 'offer' && (
            <div className="schedule-offer-actions">
              <button className="schedule-accept" onClick={() => setPhase('contact')}>Book this time</button>
              <button className="schedule-reroll" onClick={loadSlot}>Find another</button>
            </div>
          )}
        </div>
      )}
      {(phase === 'contact' || phase === 'verify-email' || phase === 'verify-waiting') && (
        <form className="schedule-contact" onSubmit={(e) => { e.preventDefault(); void confirmBooking(); }}>
          <label>Name<input value={name} onChange={(e) => setName(e.target.value)} required /></label>
          <label>
            Email
            <div className="schedule-email-row">
              <input type="email" value={email} onChange={(e) => { setEmail(e.target.value); setEmailVerified(false); }} required disabled={emailVerified} />
              {!emailVerified && phase !== 'verify-waiting' && (
                <button type="button" className="schedule-verify-btn" onClick={handleVerifyEmail} disabled={phase === 'verify-email'}>
                  {phase === 'verify-email' ? 'Sending…' : 'Verify'}
                </button>
              )}
              {emailVerified && <span className="schedule-verified-badge">✓ Verified</span>}
            </div>
          </label>
          {phase === 'verify-waiting' && (
            <div className="schedule-verify-notice">
              <p>Check your inbox for a verification email from AWS, then click below.</p>
              <button type="button" className="schedule-verify-btn" onClick={handleCheckVerification}>I've Verified My Email</button>
            </div>
          )}
          <label>Phone<input value={phone} onChange={(e) => setPhone(e.target.value)} required /></label>
          <button type="submit" className="schedule-accept" disabled={!emailVerified}>Confirm appointment</button>
          {!emailVerified && email.trim() && phase === 'contact' && (
            <p className="schedule-verify-hint">Please verify your email to receive a confirmation.</p>
          )}
        </form>
      )}
      {phase === 'booking' && <div className="schedule-booking">Booking…</div>}
    </div>
  );
}
