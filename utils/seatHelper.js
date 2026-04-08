'use strict';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * seatHelper.js  —  MEE Seat Assignment Engine
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * DESIGN PRINCIPLES:
 *
 *  1. Seat numbers are ONLY assigned at payment-success time.
 *     Never at order-creation, never at reservation time.
 *
 *  2. The "paid seat counter" (paidSeatCount) is the ONLY source of truth.
 *     It increments by 1 for every ticket that actually gets paid.
 *     It NEVER decrements — cancelled bookings do NOT affect it.
 *
 *  3. Cancelled/failed seat numbers go into releasedSeats pool (ordered queue).
 *     Pool seats are issued FIRST (FIFO) before using the counter.
 *     This recycles gaps so seat numbers stay dense.
 *
 *  4. Every single seat number comes from ONE atomic MongoDB operation.
 *     Two simultaneous payments can never get the same number.
 *
 *  5. Standing/general categories are exempt — no seat numbers assigned.
 *
 * FLOW:
 *
 *   createOrder  →  reserve capacity only ($inc bookedSeats)
 *   verifyPayment / webhook / staff sell
 *                →  assignSeatNumbers() called once per booking
 *                →  for each ticket:
 *                     a) atomic $pop from releasedSeats queue (recycled gap)
 *                     b) if pool empty: atomic $inc on paidSeatCount (fresh number)
 *                →  seat number = prefix + (seatStart - 1 + seatNumber)
 *
 *   cancel/fail  →  releaseSeatsToPool() pushes seat numbers back into queue
 *                →  bookedSeats decremented
 *                →  paidSeatCount NOT touched
 *
 * RESULT: No duplicates. No permanent gaps. Works across online, offline,
 *         retry-payment, webhook, and concurrent bookings.
 * ═══════════════════════════════════════════════════════════════════════════
 */

const Event = require('../models/Event');

// ─────────────────────────────────────────────────────────────────────────────
// isStandingCategory
// Returns true when this ticket type should NOT get a seat number.
// ─────────────────────────────────────────────────────────────────────────────
function isStandingCategory(ttype) {
  if (!ttype) return false;
  if (ttype.isStanding === true)      return true;
  if (ttype.isStanding === false)     return false;
  if (ttype.seatType === 'sitting')   return false;
  if (ttype.seatType === 'standing')  return true;
  const cat  = (ttype.category   || '').toLowerCase();
  const type = (ttype.ticketType || '').toLowerCase();
  return type === 'standing' || cat === 'standing' || cat === 'general' || cat === 'fanfit';
}

// ─────────────────────────────────────────────────────────────────────────────
// popOneSeatFromPool
// Atomically removes and returns the FIRST seat number from releasedSeats.
// Returns the raw seat number (integer) or null if queue is empty.
// ─────────────────────────────────────────────────────────────────────────────
async function popOneSeatFromPool(eventId, ttypeId) {
  // $pop with -1 removes from the FRONT of the array (FIFO)
  // We use { new: false } so we get the document BEFORE the pop,
  // letting us read what was at index 0.
  const before = await Event.findOneAndUpdate(
    {
      _id: eventId,
      'ticketTypes._id': ttypeId,
      'ticketTypes.releasedSeats.0': { $exists: true },
    },
    { $pop: { 'ticketTypes.$.releasedSeats': -1 } },
    { new: false }
  ).lean().catch(() => null);

  if (!before) return null;

  const tt = before.ticketTypes?.find(
    t => t._id.toString() === ttypeId.toString()
  );
  // releasedSeats[0] in the pre-pop doc is what we just removed
  const seat = tt?.releasedSeats?.[0];
  return (seat !== undefined && seat !== null) ? seat : null;
}

// ─────────────────────────────────────────────────────────────────────────────
// getNextFreshSeatNumber
// Atomically increments paidSeatCount and returns a unique seat number.
// paidSeatCount only ever goes UP — guarantees no two tickets share a number.
// ─────────────────────────────────────────────────────────────────────────────
async function getNextFreshSeatNumber(eventId, ttypeId, seatStart) {
  const updated = await Event.findOneAndUpdate(
    { _id: eventId, 'ticketTypes._id': ttypeId },
    { $inc: { 'ticketTypes.$.paidSeatCount': 1 } },
    { new: true }
  ).lean().catch(() => null);

  if (!updated) throw new Error(`getNextFreshSeatNumber: event/ttype not found (${eventId}/${ttypeId})`);

  const tt = updated.ticketTypes?.find(
    t => t._id.toString() === ttypeId.toString()
  );
  if (!tt) throw new Error(`getNextFreshSeatNumber: ttype not found after update`);

  // paidSeatCount is post-increment. Seat 1 = seatStart + 0, seat 2 = seatStart + 1 …
  return (seatStart || 1) + tt.paidSeatCount - 1;
}

// ─────────────────────────────────────────────────────────────────────────────
// assignSeatNumbers  (main export)
//
// Mutates the `tickets` array in-place, filling in seatNumber for each ticket.
// Safe to call multiple times — skips tickets that already have a seatNumber.
//
// Parameters:
//   eventId  — MongoDB ObjectId or string
//   ttype    — the ticket-type subdocument from Event (can be stale for meta,
//              but _id must be correct — we fetch fresh counters from DB)
//   tickets  — array of ticket objects to be mutated
//
// (Legacy params postIncBookedSeats, qty are accepted but ignored.)
// ─────────────────────────────────────────────────────────────────────────────
async function assignSeatNumbers(eventId, ttype, tickets /*, _legacy, _legacy */) {
  // Standing / general admission — no seat numbers
  if (!ttype || isStandingCategory(ttype)) {
    tickets.forEach(t => { t.isStanding = true; });
    return;
  }

  const prefix = (ttype.seatPrefix && ttype.seatPrefix.trim())
    ? ttype.seatPrefix.trim()
    : (ttype.category || 'ticket').toLowerCase().replace(/[^a-z0-9]/g, '_') + '_s';

  const seatStart = ttype.seatStart || 1;
  const ttypeId   = ttype._id;

  for (const ticket of tickets) {
    // Idempotency — never overwrite an already-assigned seat number
    if (ticket.seatNumber) {
      ticket.isStanding = false;
      continue;
    }

    // ── Step 1: Try recycled pool first (fills gaps, FIFO) ──
    const pooledSeat = await popOneSeatFromPool(eventId, ttypeId);

    if (pooledSeat !== null) {
      ticket.seatNumber = `${prefix}${pooledSeat}`;
    } else {
      // ── Step 2: Fresh atomic counter — the ONLY place paidSeatCount moves ──
      const freshSeatNum = await getNextFreshSeatNumber(eventId, ttypeId, seatStart);
      ticket.seatNumber = `${prefix}${freshSeatNum}`;
    }

    ticket.isStanding = false;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// releaseSeatsToPool
//
// Called when a booking is cancelled or payment fails.
// Pushes seat numbers back into releasedSeats queue and decrements bookedSeats.
// paidSeatCount is deliberately NOT touched — it only moves forward.
//
// Parameters:
//   eventId     — MongoDB ObjectId or string
//   ticketType  — category string (e.g. 'familia')
//   bookingDoc  — the Booking document (must have .tickets and .quantity)
// ─────────────────────────────────────────────────────────────────────────────
async function releaseSeatsToPool(eventId, ticketType, bookingDoc) {
  const qty = bookingDoc?.quantity || bookingDoc?.tickets?.length || 0;
  if (!qty) return;

  // Find the ttype to check if it's standing
  const freshEvent = await Event.findOne(
    { _id: eventId, 'ticketTypes.category': ticketType },
    { 'ticketTypes.$': 1 }
  ).lean().catch(() => null);

  const ttype = freshEvent?.ticketTypes?.[0];

  // Extract numeric seat numbers from ticket seatNumber strings
  const seatNumbers = [];
  if (ttype && !isStandingCategory(ttype)) {
    for (const ticket of bookingDoc.tickets || []) {
      if (ticket.seatNumber) {
        const match = String(ticket.seatNumber).match(/(\d+)$/);
        if (match) {
          const num = parseInt(match[1], 10);
          if (!isNaN(num)) seatNumbers.push(num);
        }
      }
    }
  }

  // Atomic update: decrement bookedSeats + push released seats to pool
  const updateOp = {
    $inc: { 'ticketTypes.$.bookedSeats': -qty },
  };

  if (seatNumbers.length > 0) {
    // $each pushes multiple values; sort ascending so pool stays FIFO-friendly
    updateOp.$push = {
      'ticketTypes.$.releasedSeats': {
        $each:     seatNumbers.sort((a, b) => a - b),
        $position: 0, // prepend so smallest numbers are reused first
      },
    };
  }

  await Event.updateOne(
    {
      _id: eventId,
      'ticketTypes.category': ticketType,
      'ticketTypes.bookedSeats': { $gte: qty }, // safety: never go below 0
    },
    updateOp
  ).catch(e => console.warn('releaseSeatsToPool error:', e.message));
}

// ─────────────────────────────────────────────────────────────────────────────
// fetchFreshTtype
// Fetches the latest ttype snapshot from DB — use this just before
// assignSeatNumbers to pass a non-stale ttype (for prefix/seatStart meta).
// ─────────────────────────────────────────────────────────────────────────────
async function fetchFreshTtype(eventId, ticketCategory) {
  const fresh = await Event.findOne(
    { _id: eventId, 'ticketTypes.category': ticketCategory },
    { 'ticketTypes.$': 1 }
  ).lean().catch(() => null);
  return fresh?.ticketTypes?.[0] || null;
}

module.exports = {
  isStandingCategory,
  assignSeatNumbers,
  releaseSeatsToPool,
  fetchFreshTtype,
  // Exported for testing / advanced use:
  popOneSeatFromPool,
  getNextFreshSeatNumber,
};