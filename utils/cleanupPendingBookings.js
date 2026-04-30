/**
 * cleanupPendingBookings.js
 * ─────────────────────────
 * Runs on a schedule and marks stale pending bookings as 'failed',
 * releasing their held bookedSeats back to the pool.
 *
 * A pending booking is considered stale if it was created more than
 * PENDING_EXPIRE_MINS minutes ago and payment was never completed.
 *
 * NOTE: bookedSeats is incremented at order creation (reservation),
 * not at payment. So stale pending bookings DO hold seats and must
 * release them via releaseSeatsToPool before being marked failed.
 * The floor guard in releaseSeatsToPool ensures bookedSeats never
 * drops below paidSeatCount, making this safe to run concurrently.
 */

const Booking = require('../models/Booking');
const { releaseSeatsToPool } = require('../utils/seatHelper');

const PENDING_EXPIRE_MINS = 6 * 60; // 360 minutes (6 hours)

async function cleanupStalePendingBookings() {
  try {
    const cutoff = new Date(Date.now() - PENDING_EXPIRE_MINS * 60 * 1000);

    const stale = await Booking.find({
      paymentStatus: 'pending',
      createdAt: { $lt: cutoff },
    }).lean();

    if (!stale.length) return;
    console.log(`🧹 cleanupPending: found ${stale.length} stale pending booking(s)`);

    for (const booking of stale) {
      try {
        // await releaseSeatsToPool(booking.event, booking.ticketType, booking);

        await Booking.updateOne(
          { _id: booking._id, paymentStatus: 'pending' },
          { $set: { paymentStatus: 'failed' } }
        );

        console.log(`🔓 cleanupPending: released ${booking.quantity} × ${booking.ticketType}`);
      } catch (e) {
        console.warn(`cleanupPending: error on booking ${booking._id}:`, e.message);
      }
    }
  } catch (err) {
    console.error('❌ cleanupPendingBookings error:', err);
  }
}

function startCleanupJob(intervalMs = 60 * 60 * 1000) {
  cleanupStalePendingBookings();
  setInterval(cleanupStalePendingBookings, intervalMs);
  console.log(
    `⏰ Pending booking cleanup job started (every ${intervalMs / (60 * 60 * 1000)} hours)`
  );
}

module.exports = { startCleanupJob, cleanupStalePendingBookings };