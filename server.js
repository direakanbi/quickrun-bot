const express = require('express');
const connectDB = require('./db');
const startBot = require('./bot');
const User = require('./models/userModel');

require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Connect to MongoDB
connectDB();

// Start the WhatsApp bot
startBot();

app.use(express.json());

app.post('/api/runners', async (req, res) => {
    try {
        const runner = new User({
            phoneNumber: req.body.phoneNumber,
            role: 'runner',
            name: req.body.name
        });
        await runner.save();
        res.json({ success: true, runner });
    } catch (error) {
        res.status(400).json({ success: false, error: error.message });
    }
});

app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));