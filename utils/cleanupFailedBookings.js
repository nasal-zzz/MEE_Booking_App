/**
 * cleanupFailedBookings.js
 * ────────────────────────
 * Runs on a schedule (every 2 hours) and permanently deletes stale failed
 * bookings from the database.
 *
 * A failed booking is eligible for deletion if it has been in 'failed'
 * paymentStatus for more than FAILED_EXPIRE_MINS minutes.
 *
 * Safe because:
 *  - Only targets bookings with paymentStatus = 'failed'
 *  - Failed bookings never incremented bookedSeats, so deletion won't
 *    affect seat counts or any other booking aggregates
 */

const Booking = require('../models/Booking');

// ✅ Delete failed bookings after 2 hours
const FAILED_EXPIRE_MINS = 2 * 60; // 120 minutes

async function cleanupFailedBookings() {
  try {
    const cutoff = new Date(Date.now() - FAILED_EXPIRE_MINS * 60 * 1000);

    const result = await Booking.deleteMany({
      paymentStatus: 'failed',
      createdAt: { $lt: cutoff },
    });

    if (result.deletedCount > 0) {
      console.log(
        `🗑️  cleanupFailed: deleted ${result.deletedCount} failed booking(s) older than ${FAILED_EXPIRE_MINS} mins`
      );
    }
  } catch (err) {
    console.error('❌ cleanupFailedBookings error:', err);
  }
}

/**
 * Start the cleanup interval.
 * Call this once from server.js after DB connects.
 */
function startFailedCleanupJob(intervalMs = 2 * 60 * 60 * 1000) {
  // ✅ Run immediately on server start
  cleanupFailedBookings();

  // ✅ Run every 2 hours
  setInterval(cleanupFailedBookings, intervalMs);

  console.log(
    `⏰ Unsuccessful booking cleanup job started (every ${intervalMs / (60 * 60 * 1000)} hours)`
  );
}

module.exports = {
  startFailedCleanupJob,
  cleanupFailedBookings,
};