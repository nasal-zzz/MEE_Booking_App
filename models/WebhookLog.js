// models/WebhookLog.js
// Permanent audit log for every Razorpay webhook event received.
// Never deletes. Cross-referenced with Booking collection.

const mongoose = require('mongoose');

const webhookLogSchema = new mongoose.Schema(
  {
    // ── Razorpay Event ──
    razorpayEventId:  { type: String, index: true, default: '' },
    eventType:        { type: String, required: true, index: true }, // payment.captured / payment.failed / order.paid / etc.

    // ── Payment identifiers ──
    orderId:          { type: String, index: true, default: '' },
    paymentId:        { type: String, index: true, default: '' },

    // ── Financial ──
    amount:           { type: Number, default: 0 },        // in paise (as Razorpay sends)
    amountInRupees:   { type: Number, default: 0 },        // convenience
    currency:         { type: String, default: 'INR' },
    razorpayStatus:   { type: String, default: '' },       // captured / failed / refunded

    // ── Payment method ──
    method:           { type: String, default: '' },       // upi / card / netbanking / wallet
    bank:             { type: String, default: '' },
    wallet:           { type: String, default: '' },
    vpa:              { type: String, default: '' },        // UPI VPA

    // ── Customer ──
    contact:          { type: String, default: '' },
    email:            { type: String, default: '' },
    description:      { type: String, default: '' },

    // ── Error details (payment.failed) ──
    errorCode:           { type: String, default: '' },
    errorDescription:    { type: String, default: '' },
    errorReason:         { type: String, default: '' },
    errorSource:         { type: String, default: '' },
    errorStep:           { type: String, default: '' },

    // ── Booking cross-reference (populated during webhook processing) ──
    bookingRef:       { type: String, default: '', index: true },
    bookingId:        { type: mongoose.Schema.Types.ObjectId, ref: 'Booking', default: null },
    bookingStatus:    { type: String, default: '' },       // paid / pending / failed / not_found

    // ── Razorpay live API enrichment ──
    // Set when admin visits the transactions page and we fetch fresh data
    liveEnrichedAt:   { type: Date, default: null },
    liveMethod:       { type: String, default: '' },
    liveStatus:       { type: String, default: '' },
    liveNotes:        { type: mongoose.Schema.Types.Mixed, default: null },

    // ── Processing outcome ──
    processingStatus: {
      type: String,
      enum: [
        'ok',
        'already_processed',
        'already_processed_by_verify',
        'no_booking_found',
        'missing_references',
        'error',
        'ignored',
      ],
      default: 'ignored',
      index: true,
    },
    processingError:  { type: String, default: '' },

    // ── Signature ──
    signatureValid:   { type: Boolean, default: false },

    // ── Full raw payload for complete auditability ──
    rawPayload:       { type: mongoose.Schema.Types.Mixed },

    // ── Razorpay's own timestamp ──
    razorpayCreatedAt: { type: Date, default: null },
  },
  {
    timestamps: true,          // createdAt = when WE received it
    collection: 'webhooklogs',
  }
);

// Compound indexes for common filter combos
webhookLogSchema.index({ eventType: 1, createdAt: -1 });
webhookLogSchema.index({ processingStatus: 1, createdAt: -1 });
webhookLogSchema.index({ createdAt: -1 });

module.exports = mongoose.model('WebhookLog', webhookLogSchema);