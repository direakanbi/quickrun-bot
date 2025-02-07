const mongoose = require('mongoose');

const orderSchema = new mongoose.Schema({
    orderId: { type: String, unique: true },
    clientPhone: { type: String, required: true },
    runnerPhone: { type: String },
    description: { type: String, required: true },
    pickupLocation: { type: String, required: true },
    deliveryLocation: { type: String, required: true },
    price: { type: Number, required: true },
    status: { type: String, enum: ['pending', 'claimed', 'in_progress', 'completed'], default: 'pending' },
    paymentStatus: { type: String, enum: ['unpaid', 'paid'], default: 'unpaid' },
}, { timestamps: true });

module.exports = mongoose.model('Order', orderSchema);
