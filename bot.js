const makeWASocket = require('@whiskeysockets/baileys').default;
const { useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const qrcode = require('qrcode-terminal');
const { Order, calculateDeliveryFee } = require('./models/orderModel');
const User = require('./models/userModel');
const Session = require('./models/sessionModel');

async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState('auth');
    const sock = makeWASocket({ auth: state });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;
        
        if (qr) {
            console.log('⚡ QR Code received, please scan with WhatsApp:');
            qrcode.generate(qr, { small: true });
        }
        
        if (connection === 'close') {
            if (lastDisconnect.error?.output?.statusCode !== DisconnectReason.loggedOut) {
                console.log('⚡ Connection closed, reconnecting...');
                startBot();
            } else {
                console.log('❌ Connection closed - logged out.');
            }
        } else if (connection === 'open') {
            console.log('✅ WhatsApp Bot Connected');
        }
    });

    sock.ev.on('messages.upsert', async (msg) => {
        console.log('=== New Message Event ===');
        console.log('Message type:', msg.type);
        
        const message = msg.messages[0];
        if (!message) {
            console.log('No message found in update');
            return;
        }
        
        console.log('Message from:', message.key.remoteJid);
        console.log('Is from me:', message.key.fromMe);
        
        // Don't process messages sent by the bot itself
        if (message.key.fromMe) {
            console.log('Message is from bot, ignoring');
            return;
        }

        try {
            const sender = message.key.remoteJid;
            
            // Get message text from different possible message types
            const text = message.message?.conversation || 
                         message.message?.extendedTextMessage?.text || 
                         message.message?.buttonTextMessage?.text || 
                         message.message?.templateButtonReplyMessage?.selectedDisplayText || 
                         '';

            console.log('Processed text:', text);
            
            if (!text) {
                console.log('No text content found in message');
                return;
            }

            // Add welcome message for greetings
            const greetings = ['hi', 'hello', 'hey', 'start'];
            if (greetings.includes(text.toLowerCase().trim())) {
                await sock.sendMessage(sender, { 
                    text: `👋 Welcome to QuickRun!\n\nWhat would you like to do?\n\n1️⃣ *Create new errand*\n2️⃣ Track existing order\n\nReply with the number of your choice (1 or 2).`
                });
                return;
            }

            // Handle first choice (1) - Show errand types
            if (text === '1') {
                await sock.sendMessage(sender, {
                    text: `📦 *Select Errand Type*\n\n1️⃣ *Pick & Deliver*\n_Example: Picking up a package from one location and delivering to another_\n\n2️⃣ *Purchase & Deliver*\n_Example: Buying groceries from a store and delivering to your location_\n\nReply with 1 or 2 to select errand type.`
                });
                
                // Update session to await errand type selection
                await Session.findOneAndUpdate(
                    { phoneNumber: sender.replace('@s.whatsapp.net', '') },
                    { 
                        state: 'AWAITING_ERRAND_TYPE',
                        currentOrder: {} 
                    },
                    { upsert: true, new: true }
                );
                return;
            }

            // Handle different states of order creation
            const session = await Session.findOne({ phoneNumber: sender.replace('@s.whatsapp.net', '') });
            if (session) {
                switch (session.state) {
                    case 'AWAITING_ERRAND_TYPE':
                        if (text === '1') {  // Pick & Deliver
                            session.currentOrder.type = 'pick_deliver';
                            session.state = 'AWAITING_PICKUP';
                            await session.save();
                            
                            await sock.sendMessage(sender, {
                                text: '📍 Please enter the pickup location:\n\n_Type *cancel* at any time to cancel order creation_'
                            });
                        } else if (text === '2') {  // Purchase & Deliver
                            session.currentOrder.type = 'purchase_deliver';
                            session.state = 'AWAITING_STORE';
                            await session.save();
                            
                            await sock.sendMessage(sender, {
                                text: '🏪 Please enter the store/shop location where items should be purchased:\n\n_Type *cancel* at any time to cancel order creation_'
                            });
                        } else {
                            await sock.sendMessage(sender, {
                                text: '⚠️ Please select a valid option (1 or 2)'
                            });
                        }
                        return;

                    case 'AWAITING_PICKUP':
                        // Validate pickup location
                        if (text.length < 3) {
                            await sock.sendMessage(sender, {
                                text: '⚠️ Pickup location is too short. Please provide a more detailed address.'
                            });
                            return;
                        }
                        if (text.length > 100) {
                            await sock.sendMessage(sender, {
                                text: '⚠️ Pickup location is too long. Please provide a shorter address.'
                            });
                            return;
                        }

                        session.currentOrder.pickupLocation = text;
                        session.state = 'AWAITING_DELIVERY';
                        await session.save();
                        
                        await sock.sendMessage(sender, {
                            text: '📍 Great! Now enter the delivery location:\n\n_Type *cancel* at any time to cancel_'
                        });
                        return;

                    case 'AWAITING_DELIVERY':
                        // Validate delivery location
                        if (text.length < 3) {
                            await sock.sendMessage(sender, {
                                text: '⚠️ Delivery location is too short. Please provide a more detailed address.'
                            });
                            return;
                        }
                        if (text.length > 100) {
                            await sock.sendMessage(sender, {
                                text: '⚠️ Delivery location is too long. Please provide a shorter address.'
                            });
                            return;
                        }
                        if (text.toLowerCase() === session.currentOrder.pickupLocation.toLowerCase()) {
                            await sock.sendMessage(sender, {
                                text: '⚠️ Delivery location cannot be the same as pickup location.'
                            });
                            return;
                        }

                        session.currentOrder.deliveryLocation = text;
                        session.state = 'AWAITING_DESCRIPTION';
                        await session.save();
                        
                        await sock.sendMessage(sender, {
                            text: '📦 What items need to be delivered? (Please describe the items)\n\n_Type *cancel* at any time to cancel_'
                        });
                        return;

                    case 'AWAITING_DESCRIPTION':
                        // Validate description
                        if (text.length < 3) {
                            await sock.sendMessage(sender, {
                                text: '⚠️ Description is too short. Please provide more details about the items.'
                            });
                            return;
                        }
                        if (text.length > 200) {
                            await sock.sendMessage(sender, {
                                text: '⚠️ Description is too long. Please keep it under 200 characters.'
                            });
                            return;
                        }

                        session.currentOrder.description = text;
                        session.state = 'AWAITING_PRICE';
                        await session.save();
                        
                        const pricePrompt = session.currentOrder.type === 'purchase_deliver' 
                            ? '💰 What is your budget for the items and delivery? (Enter amount in Naira)\n\nThis should include:\n- Cost of items to be purchased\n- Delivery fee\n\nExample: 2500\n\n_Type *cancel* at any time to cancel_'
                            : '💰 What is your budget for this delivery? (Enter amount in Naira)\n\nExample: 2500\n\n_Type *cancel* at any time to cancel_';
                        
                        await sock.sendMessage(sender, {
                            text: pricePrompt
                        });
                        return;

                    case 'AWAITING_PRICE':
                        // Validate price
                        const itemPrice = parseInt(text.replace(/[^0-9]/g, ''));
                        if (isNaN(itemPrice)) {
                            await sock.sendMessage(sender, {
                                text: '⚠️ Please enter a valid number for the price.\n\nExample: 2500'
                            });
                            return;
                        }
                        if (itemPrice < 500) {
                            await sock.sendMessage(sender, {
                                text: '⚠️ Minimum order value is ₦500.'
                            });
                            return;
                        }
                        if (itemPrice > 50000) {
                            await sock.sendMessage(sender, {
                                text: '⚠️ Maximum order value is ₦50,000. For higher values, please contact support.'
                            });
                            return;
                        }

                        const deliveryFee = calculateDeliveryFee(itemPrice);
                        const totalPrice = itemPrice + deliveryFee;

                        // Show price breakdown
                        await sock.sendMessage(sender, {
                            text: `💰 *Price Breakdown*\n\n` +
                                `Items: ₦${itemPrice.toLocaleString()}\n` +
                                `Delivery Fee: ₦${deliveryFee.toLocaleString()}\n` +
                                `Total: ₦${totalPrice.toLocaleString()}\n\n` +
                                `Reply with *confirm* to create this order or *cancel* to start over.`
                        });

                        session.currentOrder.itemPrice = itemPrice;
                        session.currentOrder.deliveryFee = deliveryFee;
                        session.currentOrder.totalPrice = totalPrice;
                        session.state = 'AWAITING_CONFIRMATION';
                        await session.save();
                        return;

                    case 'AWAITING_CONFIRMATION':
                        if (text.toLowerCase() === 'confirm') {
                            // Create the order with price breakdown
                            const order = new Order({
                                orderId: `ORD${Date.now()}`,
                                clientPhone: sender.replace('@s.whatsapp.net', ''),
                                pickupLocation: session.currentOrder.pickupLocation,
                                deliveryLocation: session.currentOrder.deliveryLocation,
                                description: session.currentOrder.description,
                                itemPrice: session.currentOrder.itemPrice,
                                deliveryFee: session.currentOrder.deliveryFee,
                                totalPrice: session.currentOrder.totalPrice,
                                status: 'pending'
                            });
                            await order.save();

                            // Reset session
                            session.state = 'IDLE';
                            session.currentOrder = {};
                            await session.save();

                            // Send confirmation with price breakdown
                            await sock.sendMessage(sender, {
                                text: `✅ Order created!\n\n` +
                                    `📍 *Pickup:* ${order.pickupLocation}\n` +
                                    `📍 *Drop-off:* ${order.deliveryLocation}\n` +
                                    `📦 *Items:* ${order.description}\n\n` +
                                    `💰 *Price Breakdown:*\n` +
                                    `Items: ₦${order.itemPrice.toLocaleString()}\n` +
                                    `Delivery Fee: ₦${order.deliveryFee.toLocaleString()}\n` +
                                    `Total: ₦${order.totalPrice.toLocaleString()}\n\n` +
                                    `🔢 *Order ID:* ${order.orderId}\n\n` +
                                    `*Available runners will be notified shortly.*`
                            });

                            notifyRunners(sock, order);
                        } else if (text.toLowerCase() === 'cancel') {
                            session.state = 'IDLE';
                            session.currentOrder = {};
                            await session.save();
                            
                            await sock.sendMessage(sender, {
                                text: '❌ Order cancelled. Send *hi* to start over.'
                            });
                        } else {
                            await sock.sendMessage(sender, {
                                text: '⚠️ Please reply with *confirm* to create the order or *cancel* to start over.'
                            });
                        }
                        return;

                    case 'AWAITING_STORE':
                        // Validate store location
                        if (text.length < 3) {
                            await sock.sendMessage(sender, {
                                text: '⚠️ Store location is too short. Please provide a more detailed address.'
                            });
                            return;
                        }
                        if (text.length > 100) {
                            await sock.sendMessage(sender, {
                                text: '⚠️ Store location is too long. Please provide a shorter address.'
                            });
                            return;
                        }

                        session.currentOrder.pickupLocation = text; // Store location is pickup location
                        session.state = 'AWAITING_DELIVERY';
                        await session.save();
                        
                        await sock.sendMessage(sender, {
                            text: '📍 Great! Now enter your delivery location:\n\n_Type *cancel* at any time to cancel_'
                        });
                        return;
                }
            }

            // Add help command
            if (text.toLowerCase() === 'help') {
                await sock.sendMessage(sender, { 
                    text: `🆘 *QuickRun Help*\n\n*For Clients:*\nSend *hi* to create a new order\n\n*For Runners:*\n- *claim [OrderID]* - Claim an order\n- *pickup [OrderID]* - Mark order as picked up\n- *delivered [OrderID]* - Mark order as delivered\n\nNeed more help? Contact our support.`
                });
                return;
            }

            if (text.toLowerCase().startsWith('new order')) {
                console.log('New order detected, processing...');
                const orderDetails = text.split('|');
                if (orderDetails.length < 5) {
                    await sock.sendMessage(sender, { 
                        text: '⚠️ Invalid format! Use: *New Order | Pickup | Delivery | Description | Price*'
                    });
                    return;
                }

                const order = new Order({
                    orderId: `ORD${Date.now()}`,
                    clientPhone: sender.replace('@s.whatsapp.net', ''),
                    pickupLocation: orderDetails[1].trim(),
                    deliveryLocation: orderDetails[2].trim(),
                    description: orderDetails[3].trim(),
                    price: parseInt(orderDetails[4].trim()),
                });
                await order.save();

                await sock.sendMessage(sender, { 
                    text: `✅ Order created!\n\n📍 *Pickup:* ${order.pickupLocation}\n📍 *Drop-off:* ${order.deliveryLocation}\n💰 *Price:* ₦${order.price}\n\n*Available runners will be notified shortly.*`
                });

                notifyRunners(sock, order);
            } 

            if (text.toLowerCase() === 'yes') {
                // Find runner and their last order
                const runner = await User.findOne({ 
                    phoneNumber: sender.replace('@s.whatsapp.net', ''),
                    role: 'runner'
                });

                if (!runner || !runner.lastOrderSent) {
                    await sock.sendMessage(sender, { 
                        text: '⚠️ No pending order to claim. Wait for new order notifications.'
                    });
                    return;
                }

                // Try to claim the last order sent to this runner
                const order = await Order.findOne({ 
                    orderId: runner.lastOrderSent,
                    status: 'pending'
                });

                if (!order) {
                    await sock.sendMessage(sender, { 
                        text: '⚠️ This order is no longer available.'
                    });
                    // Clear lastOrderSent since it's no longer valid
                    runner.lastOrderSent = null;
                    await runner.save();
                    return;
                }

                // Claim the order
                order.runnerPhone = runner.phoneNumber;
                order.status = 'claimed';
                await order.save();

                // Clear lastOrderSent
                runner.lastOrderSent = null;
                await runner.save();

                // Notify runner
                await sock.sendMessage(sender, { 
                    text: `✅ You have claimed the order!\n\n📱 Contact the client at: +${order.clientPhone}\n\n*Once you've picked up the order, send:*\n*pickup*`
                });

                // Notify client
                await sock.sendMessage(order.clientPhone + '@s.whatsapp.net', { 
                    text: `🚀 Your order has been claimed by a runner. Expect a call soon.`
                });
            }

            // Update pickup command to be simpler
            if (text.toLowerCase() === 'pickup') {
                const order = await Order.findOne({ 
                    status: 'claimed',
                    runnerPhone: sender.replace('@s.whatsapp.net', '')
                });

                if (!order) {
                    await sock.sendMessage(sender, { 
                        text: '⚠️ No claimed order found to pick up.'
                    });
                    return;
                }

                // Update order status
                order.status = 'picked_up';
                order.pickupTime = new Date();
                await order.save();

                // Notify runner
                await sock.sendMessage(sender, { 
                    text: `✅ Great! You've picked up Order ${order.orderId}.\n\n📍 *Delivery Location:* ${order.deliveryLocation}\n\nPlease update once delivered by sending:\n*delivered ${order.orderId}*`
                });

                // Notify client
                await sock.sendMessage(order.clientPhone + '@s.whatsapp.net', { 
                    text: `🚚 *Order Update*\n\nYour order (${order.orderId}) has been picked up by the runner!\n\n⏱️ *Pickup Time:* ${order.pickupTime.toLocaleTimeString()}\n📍 *Destination:* ${order.deliveryLocation}\n\nYou'll be notified once the delivery is completed.`
                });
            }

            // Add delivery confirmation
            if (text.toLowerCase() === 'delivered') {
                const order = await Order.findOne({ 
                    status: 'picked_up',
                    runnerPhone: sender.replace('@s.whatsapp.net', '')
                });

                if (!order) {
                    await sock.sendMessage(sender, { 
                        text: '⚠️ No active delivery found to complete.'
                    });
                    return;
                }

                // Update order status
                order.status = 'delivered';
                order.deliveryTime = new Date();
                await order.save();

                // Calculate delivery duration
                const duration = Math.round((order.deliveryTime - order.pickupTime) / (1000 * 60)); // in minutes

                // Notify runner
                await sock.sendMessage(sender, { 
                    text: `✅ Delivery completed!\n\nThank you for using QuickRun. You'll be notified of new orders.`
                });

                // Notify client
                await sock.sendMessage(order.clientPhone + '@s.whatsapp.net', { 
                    text: `🎉 *Delivery Complete!*\n\nYour order has been delivered!\n\n⏱️ *Delivery Time:* ${order.deliveryTime.toLocaleTimeString()}\n⌛ *Total Duration:* ${duration} minutes\n\nThank you for using QuickRun! Send *hi* to create another order.`
                });
            }
        } catch (error) {
            console.error('Error processing message:', error);
            try {
                await sock.sendMessage(message.key.remoteJid, { 
                    text: '❌ Sorry, there was an error processing your message. Please try again.'
                });
            } catch (sendError) {
                console.error('Error sending error message:', sendError);
            }
        }
    });

    async function notifyRunners(sock, order) {
        const runners = await User.find({ role: 'runner' });
    
        for (const runner of runners) {
            // Update runner's lastOrderSent
            await User.findByIdAndUpdate(runner._id, {
                lastOrderSent: order.orderId
            });
    
            // Send notification with simplified claim instructions
            const message = `🚀 *New Order Available!*\n\n` +
                `📍 *Pickup:* ${order.pickupLocation}\n` +
                `📍 *Drop-off:* ${order.deliveryLocation}\n` +
                `💰 *Earnings:* ₦${order.deliveryFee}\n\n` +
                `To claim this order, simply reply with *yes*`;
    
            await sock.sendMessage(runner.phoneNumber + '@s.whatsapp.net', { 
                text: message 
            });
        }
    }
    
    return sock;
}

async function sendWhatsAppMessage(sock, to, text) {
    console.log(`Attempting to send message to ${to}: ${text}`);
    try {
        await sock.sendMessage(to, { text });
        console.log('Message sent successfully');
        return true;
    } catch (error) {
        console.error('Failed to send message:', error);
        return false;
    }
}

module.exports = startBot;
