
  /**
   * cleanupPendingBookings.js
   * ─────────────────────────
   * Runs on a schedule (every 12 hours) and marks stale pending bookings as
   * 'failed'.
   *
   * A pending booking is considered stale if it was created more than
   * PENDING_EXPIRE_MINS minutes ago and payment was never completed.
   *
   * Safe because:
   *  - bookedSeats is incremented ONLY when paymentStatus = 'paid'
   *  - So expiring pending bookings will not affect seat counts
   */

  const Booking = require('../models/Booking');

  // ✅ Expire pending bookings after 6 hours
  const PENDING_EXPIRE_MINS = 6 * 60; // 720 minutes

  async function cleanupStalePendingBookings() {
    try {
      const cutoff = new Date(Date.now() - PENDING_EXPIRE_MINS * 60 * 1000);

      const result = await Booking.updateMany(
        {
          paymentStatus: 'pending',
          createdAt: { $lt: cutoff },
        },
        {
          $set: { paymentStatus: 'failed' }, // ✅ explicit update (best practice)
        }
      );

      if (result.modifiedCount > 0) {
        console.log(
          `🧹 cleanupPending: expired ${result.modifiedCount} booking(s) older than ${PENDING_EXPIRE_MINS} mins`
        );
      }
    } catch (err) {
      console.error('❌ cleanupPendingBookings error:', err);
    }
  }

  /**
   * Start the cleanup interval.
   * Call this once from server.js after DB connects.
   */
  function startCleanupJob(intervalMs = 6 * 60 * 60 * 1000) {
    // ✅ Run immediately on server start
    cleanupStalePendingBookings();

    // ✅ Run every 6 hours
    setInterval(cleanupStalePendingBookings, intervalMs);

    console.log(
      `⏰ Pending booking cleanup job started (every ${intervalMs / (60 * 60 * 1000)} hours)`
    );
  }

  module.exports = {
    startCleanupJob,
    cleanupStalePendingBookings,
  };