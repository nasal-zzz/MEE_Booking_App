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
  const seat = tt?.releasedSeats?.[0];
  return (seat !== undefined && seat !== null) ? seat : null;
}

// ─────────────────────────────────────────────────────────────────────────────
// getNextFreshSeatNumber
// Atomically increments paidSeatCount and returns a unique seat number.
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

  return (seatStart || 1) + tt.paidSeatCount - 1;
}

// ─────────────────────────────────────────────────────────────────────────────
// assignSeatNumbers
// ─────────────────────────────────────────────────────────────────────────────
async function assignSeatNumbers(eventId, ttype, tickets) {

  if (!ttype || isStandingCategory(ttype)) {
    tickets.forEach(t => { t.isStanding = true; });
    await Event.updateOne(
      { _id: eventId, 'ticketTypes.category': ttype.category },
      { $inc: { 'ticketTypes.$.paidSeatCount': tickets.length } }
    ).catch(e => console.warn('assignSeatNumbers (standing) paidSeatCount error:', e.message));
    return;
  }

  const prefix = (ttype.seatPrefix && ttype.seatPrefix.trim())
    ? ttype.seatPrefix.trim()
    : (ttype.category || 'ticket').toLowerCase().replace(/[^a-z0-9]/g, '_') + '_s';

  const seatStart = ttype.seatStart || 1;
  const ttypeId   = ttype._id;

  for (const ticket of tickets) {
    if (ticket.seatNumber) {
      ticket.isStanding = false;
      continue;
    }

    const pooledSeat = await popOneSeatFromPool(eventId, ttypeId);

    if (pooledSeat !== null) {
      ticket.seatNumber = `${prefix}${pooledSeat}`;
    } else {
      const freshSeatNum = await getNextFreshSeatNumber(eventId, ttypeId, seatStart);
      ticket.seatNumber = `${prefix}${freshSeatNum}`;
    }

    ticket.isStanding = false;
  }
}


async function releaseSeatsToPool(eventId, ticketType, bookingDoc) {

    if (bookingDoc?.seatsReleased === true) {
    console.log(`⚠️  releaseSeatsToPool: already released for ${bookingDoc.bookingRef} — skipping`);
    return;
  }
  
  const qty = bookingDoc?.quantity || bookingDoc?.tickets?.length || 0;
  if (!qty) return;

  const freshEvent = await Event.findOne(
    { _id: eventId, ticketTypes: { $elemMatch: { category: ticketType } } },
    { 'ticketTypes.$': 1 }
  ).lean().catch(() => null);

  const ttype = freshEvent?.ticketTypes?.[0];
  if (!ttype) {
    console.warn(`releaseSeatsToPool: ttype not found for ${ticketType}`);
    return;
  }

  const standing             = isStandingCategory(ttype);
  const currentBookedSeats   = ttype.bookedSeats;
  const currentPaidSeatCount = ttype.paidSeatCount || 0;

  // Floor guard — bookedSeats must never drop below paidSeatCount
  if (currentBookedSeats - qty < currentPaidSeatCount) {
    console.warn(
      `releaseSeatsToPool: SKIPPED — would drop bookedSeats (${currentBookedSeats}) ` +
      `below paidSeatCount (${currentPaidSeatCount}) for ${ticketType}. qty=${qty}`
    );
    return;
  }

  const updateOp = {
    $inc: { 'ticketTypes.$.bookedSeats': -qty },
  };

  // Only sitting categories push seat numbers back into the pool
  if (!standing) {
    const seatNumbers = [];
    for (const ticket of bookingDoc.tickets || []) {
      if (ticket.seatNumber) {
        const match = String(ticket.seatNumber).match(/(\d+)$/);
        if (match) {
          const num = parseInt(match[1], 10);
          if (!isNaN(num)) seatNumbers.push(num);
        }
      }
    }
    if (seatNumbers.length > 0) {
      updateOp.$push = {
        'ticketTypes.$.releasedSeats': {
          $each: seatNumbers.sort((a, b) => a - b),
          $position: 0,
        },
      };
    }
  }

  // FIX: Match on exact currentBookedSeats value instead of $gte.
  // This makes the release atomic — if another operation changed
  // bookedSeats between our read and this write, we retry once
  // rather than silently no-op.
  const result = await Event.updateOne(
    {
      _id: eventId,
      ticketTypes: {
        $elemMatch: {
          category: ticketType,
          bookedSeats: currentBookedSeats, // exact match = optimistic lock
        }
      }
    },
    updateOp
  ).catch(e => {
    console.warn(`releaseSeatsToPool updateOne error:`, e.message);
    return null;
  });

  if (result?.matchedCount === 0) {
    // Another concurrent operation changed bookedSeats — retry once
    console.warn(`releaseSeatsToPool: optimistic lock miss for ${ticketType} — retrying`);

    const retryEvent = await Event.findOne(
      { _id: eventId, ticketTypes: { $elemMatch: { category: ticketType } } },
      { 'ticketTypes.$': 1 }
    ).lean().catch(() => null);

    const retryTtype = retryEvent?.ticketTypes?.[0];
    if (!retryTtype) return;

    const retryBookedSeats   = retryTtype.bookedSeats;
    const retryPaidSeatCount = retryTtype.paidSeatCount || 0;

    if (retryBookedSeats - qty < retryPaidSeatCount) {
      console.warn(`releaseSeatsToPool: retry SKIPPED — floor guard hit for ${ticketType}`);
      return;
    }

    await Event.updateOne(
      {
        _id: eventId,
        ticketTypes: {
          $elemMatch: {
            category: ticketType,
            bookedSeats: retryBookedSeats,
          }
        }
      },
      updateOp
    ).catch(e => console.warn(`releaseSeatsToPool retry error:`, e.message));
  }

  console.log(`🔓 releaseSeatsToPool (${standing ? 'standing' : 'sitting'}): released ${qty} × ${ticketType}`);

  // SeatMap decrement — only for paid bookings that had a zone
  if (bookingDoc.zone && bookingDoc.paymentStatus === 'paid') {
    const SeatMap = require('../models/SeatMap');
    await SeatMap.updateOne(
      { event: eventId, 'sections.name': bookingDoc.zone },
      { $inc: { 'sections.$.bookedSeats': -qty } }
    ).catch(e => console.warn('releaseSeatsToPool SeatMap error:', e.message));
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// fetchFreshTtype
//
// FIX: Was using flat 'ticketTypes.category' dot-notation query.
// With multiple ticket types in the array, MongoDB's positional $
// can match the wrong subdocument when other fields (e.g. bookedSeats)
// satisfy the filter on a different element.
// $elemMatch guarantees both _id and category match the SAME element.
// ─────────────────────────────────────────────────────────────────────────────
async function fetchFreshTtype(eventId, ticketCategory) {
  const fresh = await Event.findOne(
    // FIX: was { _id: eventId, 'ticketTypes.category': ticketCategory }
    // which is a flat query — $elemMatch is required for correct element targeting
    { _id: eventId, ticketTypes: { $elemMatch: { category: ticketCategory } } },
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