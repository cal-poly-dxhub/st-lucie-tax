import { useEffect, useState } from 'react';
import { fetchSchedulingSlot, bookSchedulingAppointment, type SchedulingSlotResponse } from '../api';

interface Props {
  sessionId: string;
  defaultName?: string;
  onBooked: () => void;
}

type Phase = 'loading' | 'offer' | 'contact' | 'booking' | 'unavailable' | 'done';

export function SchedulePanel({ sessionId, defaultName, onBooked }: Props) {
  const [phase, setPhase] = useState<Phase>('loading');
  const [slot, setSlot] = useState<NonNullable<SchedulingSlotResponse['slot']>>();
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState(defaultName ?? '');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');

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

  async function confirmBooking() {
    if (!slot) return;
    const [firstName, ...rest] = name.trim().split(' ');
    const lastName = rest.join(' ') || firstName;
    setPhase('booking'); setError(null);
    try {
      await bookSchedulingAppointment(sessionId, {
        officeId: slot.officeId, date: slot.date, time: slot.time,
        firstName, lastName, email, phone,
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
  if (phase === 'done') return <div className="schedule-panel">Booked! Your confirmation is in the panel on the right.</div>;

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
      {phase === 'contact' && (
        <form className="schedule-contact" onSubmit={(e) => { e.preventDefault(); void confirmBooking(); }}>
          <label>Name<input value={name} onChange={(e) => setName(e.target.value)} required /></label>
          <label>Email<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></label>
          <label>Phone<input value={phone} onChange={(e) => setPhone(e.target.value)} required /></label>
          <button type="submit" className="schedule-accept">Confirm appointment</button>
        </form>
      )}
      {phase === 'booking' && <div className="schedule-booking">Booking…</div>}
    </div>
  );
}
