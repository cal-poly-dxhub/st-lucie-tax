/**
 * Canonical scheduling API.
 *
 * Office Operations owns slot search and booking; the chatbot consumes this
 * module rather than carrying its own queries, so both surfaces agree on the
 * packing model (back-to-back on duration boundaries plus
 * config.scheduling_block_padding — see docs/scheduling-design.md).
 */

export { findAppointment, type FindApptInput, type FindApptResult } from "./find-appt.js";

export {
  bookAppointment,
  cancelAppointment,
  PG_ERROR_MAP,
  type BookApptInput,
  type BookApptResult,
  type BookApptError,
} from "./book-appt.js";
