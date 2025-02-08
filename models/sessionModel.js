const mongoose = require('mongoose');

const sessionSchema = new mongoose.Schema({
    phoneNumber: {
        type: String,
        required: true
    },
    state: {
        type: String,
        enum: [
            'IDLE', 
            'AWAITING_ERRAND_TYPE',
            'AWAITING_STORE',
            'AWAITING_PICKUP',
            'AWAITING_DELIVERY',
            'AWAITING_DESCRIPTION',
            'AWAITING_PRICE',
            'AWAITING_CONFIRMATION'
        ],
        default: 'IDLE'
    },
    currentOrder: {
        type: {
            type: String,
            enum: ['pick_deliver', 'purchase_deliver'],
            default: null
        },
        pickupLocation: {
            type: String,
            default: null
        },
        deliveryLocation: {
            type: String,
            default: null
        },
        description: {
            type: String,
            default: null
        },
        itemPrice: {
            type: Number,
            default: null
        },
        deliveryFee: {
            type: Number,
            default: null
        },
        totalPrice: {
            type: Number,
            default: null
        }
    }
}, { timestamps: true });

module.exports = mongoose.model('Session', sessionSchema); 