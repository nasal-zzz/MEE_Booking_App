// bookingCleanup.js
'use strict';

const Booking = require('../models/Booking');
const { releaseSeatsToPool } = require('./seatHelper');

async function cleanupStaleBookings(staleAfterMs = 1.5 * 60 * 1000) {
  const cutoff = new Date(Date.now() - staleAfterMs); // ← plain Date.now()

  const staleBookings = await Booking.find({
    paymentStatus: { $in: ['pending', 'failed'] },
    seatsReleased: { $ne: true },
    createdAt: { $lt: cutoff },
  }).lean().catch(() => []);

  if (staleBookings.length > 0) {
    console.log(`🧹 Cleanup: found ${staleBookings.length} stale booking(s) to release`);
  } else {
    console.log(`🧹 Cleanup: no stale bookings found (cutoff: ${cutoff.toISOString()})`);
  }

  for (const booking of staleBookings) {
    try {
      const fresh = await Booking.findById(booking._id)
        .select('paymentStatus seatsReleased bookingRef ticketType quantity tickets zone event')
        .lean().catch(() => null);

      if (!fresh) continue;
      if (fresh.paymentStatus === 'paid') {
        console.log(`⚠️  Cleanup: skipping ${fresh.bookingRef} — paid`);
        continue;
      }
      if (fresh.seatsReleased === true) {
        console.log(`⚠️  Cleanup: skipping ${fresh.bookingRef} — already released`);
        continue;
      }

      await releaseSeatsToPool(fresh.event, fresh.ticketType, fresh)
        .catch(e => console.warn(`Cleanup releaseSeatsToPool error for ${fresh.bookingRef}:`, e.message));

      await Booking.updateOne(
        { _id: fresh._id, paymentStatus: { $nin: ['paid'] } },
        { $set: { seatsReleased: true, paymentStatus: 'failed' } }
      ).catch(() => {});

      console.log(`🔓 Cleanup: released + failed → ${fresh.bookingRef} (${fresh.ticketType} × ${fresh.quantity})`);
    } catch (err) {
      console.warn(`Cleanup error for booking ${booking._id}:`, err.message);
    }
  }
}

module.exports = { cleanupStaleBookings };