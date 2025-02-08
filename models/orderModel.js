const mongoose = require('mongoose');

const orderSchema = new mongoose.Schema({
    orderId: { type: String, unique: true },
    clientPhone: { type: String, required: true },
    runnerPhone: { type: String },
    description: { type: String, required: true },
    pickupLocation: { type: String, required: true },
    deliveryLocation: { type: String, required: true },
    itemPrice: { type: Number, required: true },
    deliveryFee: { type: Number, required: true },
    totalPrice: { type: Number, required: true },
    status: {
        type: String,
        enum: ['pending', 'claimed', 'picked_up', 'delivered', 'cancelled'],
        default: 'pending'
    },
    paymentStatus: { type: String, enum: ['unpaid', 'paid'], default: 'unpaid' },
    pickupTime: Date,
    deliveryTime: Date
}, { timestamps: true });

// Update the delivery fee calculation function
function calculateDeliveryFee(itemPrice) {
    // Base fee is ₦200 (minimum delivery fee)
    let baseFee = 200;
    
    if (itemPrice <= 1000) {
        // For orders up to ₦1000, charge 25%
        return Math.max(baseFee, itemPrice * 0.25);
    } else if (itemPrice <= 5000) {
        // For orders ₦1001-₦5000, charge 20%
        return Math.max(baseFee, itemPrice * 0.20);
    } else if (itemPrice <= 10000) {
        // For orders ₦5001-₦10000, charge 15%
        return Math.max(baseFee, itemPrice * 0.15);
    } else {
        // For orders above ₦10000, charge 10% but with a maximum cap of ₦5000
        return Math.min(5000, Math.max(baseFee, itemPrice * 0.10));
    }
}

module.exports = {
    Order: mongoose.model('Order', orderSchema),
    calculateDeliveryFee
};
