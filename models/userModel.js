const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
    phoneNumber: {
        type: String,
        required: true,
        unique: true
    },
    role: {
        type: String,
        enum: ['client', 'runner'],
        default: 'client'
    },
    name: {
        type: String,
        required: true
    },
    // Add any other fields you need
}, { timestamps: true });

module.exports = mongoose.model('User', userSchema);
