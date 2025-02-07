const makeWASocket = require('@whiskeysockets/baileys').default;
const { useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const qrcode = require('qrcode-terminal');
const Order = require('./models/orderModel');
const User = require('./models/userModel');

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
                    text: `👋 Welcome to QuickRun!\n\n*Available Commands:*\n\n1️⃣ Create a new delivery order:\n*New Order | Pickup Location | Delivery Location | Description | Price*\n\nExample:\nNew Order | Ikeja Mall | Lekki Phase 1 | 2 packages | 2500\n\n2️⃣ For Runners - Claim an order:\n*claim [OrderID]*\n\nNeed help? Just type "help" for assistance!`
                });
                return;
            }

            // Add help command
            if (text.toLowerCase() === 'help') {
                await sock.sendMessage(sender, { 
                    text: `🆘 *QuickRun Help*\n\n*How to create an order:*\nType: New Order | [Pickup] | [Delivery] | [Description] | [Price]\n\n*Example:*\nNew Order | Shoprite Ikeja | Magodo Phase 2 | 2 bags of groceries | 2500\n\n*For Runners:*\nTo claim an order, type: claim [OrderID]\n\nNeed more help? Contact our support.`
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

            if (text.toLowerCase().startsWith('claim')) {
                const orderId = text.split(' ')[1];
                const order = await Order.findOne({ orderId, status: 'pending' });
                if (!order) {
                    await sock.sendMessage(sender, { 
                        text: '⚠️ This order is no longer available or does not exist.'
                    });
                    return;
                }

                order.runnerPhone = sender.replace('@s.whatsapp.net', '');
                order.status = 'claimed';
                await order.save();

                await sock.sendMessage(sender, { 
                    text: `✅ You have claimed Order ${orderId}. Contact the client at: +${order.clientPhone}.`
                });
                await sock.sendMessage(order.clientPhone + '@s.whatsapp.net', { 
                    text: `🚀 Your order has been claimed by a runner. Expect a call soon.`
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
            const buttonMessage = {
                text: `🚀 *New Order Available!*\n\n📍 *Pickup:* ${order.pickupLocation}\n📍 *Drop-off:* ${order.deliveryLocation}\n💰 *Price:* ₦${order.price}\n\nClick the button below to claim this errand.`,
                footer: "QuickRun Errand Bot",
                buttons: [
                    { buttonId: `claim_${order.orderId}`, buttonText: { displayText: "✅ Claim Order" }, type: 1 }
                ],
                headerType: 1
            };
    
            await sock.sendMessage(runner.phoneNumber + '@s.whatsapp.net', buttonMessage);
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
