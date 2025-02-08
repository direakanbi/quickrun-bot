const express = require('express');
const connectDB = require('./db');
const startBot = require('./bot');
const User = require('./models/userModel');

require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Add body-parser middleware
app.use(express.json());

// Add request logging
app.use((req, res, next) => {
    console.log('Incoming request:', {
        method: req.method,
        path: req.path,
        body: req.body,
        headers: req.headers
    });
    next();
});

// Connect to MongoDB
connectDB();

// Start the WhatsApp bot
startBot();

app.post('/api/runners', async (req, res) => {
    try {
        console.log('Received runner registration request:', req.body);

        // Check if all required fields are present
        if (!req.body.phoneNumber || !req.body.name) {
            console.log('Missing required fields');
            return res.status(400).json({
                success: false,
                error: 'Phone number and name are required'
            });
        }

        // Validate phone number format
        const phoneNumber = req.body.phoneNumber.replace(/\D/g, ''); // Remove non-digits
        if (phoneNumber.length < 10 || phoneNumber.length > 15) {
            return res.status(400).json({
                success: false,
                error: 'Invalid phone number format. Please use international format without + symbol'
            });
        }

        // Check if runner already exists
        const existingRunner = await User.findOne({ phoneNumber });
        if (existingRunner) {
            return res.status(400).json({
                success: false,
                error: 'A runner with this phone number already exists'
            });
        }
        
        // Create new runner
        const runner = new User({
            phoneNumber: phoneNumber,
            name: req.body.name.trim(),
            role: 'runner'
        });

        await runner.save();
        res.json({ 
            success: true, 
            message: 'Runner registered successfully',
            runner: {
                name: runner.name,
                phoneNumber: runner.phoneNumber,
                role: runner.role,
                id: runner._id
            }
        });
    } catch (error) {
        console.error('Runner registration error:', error);
        res.status(400).json({ 
            success: false, 
            error: error.message 
        });
    }
});

app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));