// Order Controller
const Order = require('../src/models/Order.model');

// In-memory storage (TODO: Replace with database)
let orders = [];
let orderCounter = 1000;

// Create a new order
exports.createOrder = async (req, res) => {
    try {
        const {
            customer,
            shipping,
            paymentMethod,
            items,
            totals,
            coupon
        } = req.body;

        // Validate required fields
        if (!customer || !customer.name || !customer.phone || !customer.email) {
            return res.status(400).json({
                success: false,
                message: 'Customer information is required'
            });
        }

        // Validate shipping - province is required, not zone
        // If pickup is selected, address, province, and city are optional
        const isPickup = shipping && (shipping.pickup === true || shipping.pickup === 'true' || shipping.pickupOption === true || shipping.pickupOption === 'true');
        
        if (!shipping) {
            return res.status(400).json({
                success: false,
                message: 'Shipping information is required'
            });
        }
        
        if (!isPickup) {
            if (!shipping.address || !shipping.city || !shipping.province) {
                return res.status(400).json({
                    success: false,
                    message: 'Shipping information is required'
                });
            }
        }

        if (!paymentMethod) {
            return res.status(400).json({
                success: false,
                message: 'Payment method is required'
            });
        }

        if (!items || !Array.isArray(items) || items.length === 0) {
            return res.status(400).json({
                success: false,
                message: 'Cart is empty'
            });
        }

        // Generate order number
        const orderNumber = `ORD-${Date.now()}-${orderCounter++}`;

        // Create order object
        const orderData = {
            orderNumber,
            customer: {
                name: customer.name,
                phone: customer.phone,
                email: customer.email,
                createAccount: customer.createAccount || false
            },
            shipping: {
                address: shipping.address,
                city: shipping.city,
                province: shipping.province,
                instructions: shipping.instructions || '',
                pickup: shipping.pickup || false
            },
            paymentMethod,
            items: items.map(item => ({
                id: item.id,
                name: item.name,
                price: item.price,
                quantity: item.quantity || 1,
                image: item.image || null,
                productId: item.productId || null
            })),
            totals: {
                subtotal: totals.subtotal || 0,
                discount: totals.discount || 0,
                delivery: totals.delivery || 0,
                total: totals.total || 0
            },
            coupon: coupon || null,
            status: 'pending',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };

        // TODO: Use Order model to save to database
        // const order = await Order.create(orderData);
        
        // For now, store in memory
        orders.push(orderData);

        console.log(`[Order Controller] Order created: ${orderNumber}`);

        res.json({
            success: true,
            orderNumber: orderData.orderNumber,
            order: orderData,
            message: 'Order created successfully'
        });
    } catch (error) {
        console.error('[Order Controller] Error creating order:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to create order. Please try again.'
        });
    }
};

// Get order by order number
exports.getOrderByNumber = async (req, res) => {
    try {
        const { orderNumber } = req.params;
        
        // TODO: Use Order model to query database
        // const order = await Order.findByOrderNumber(orderNumber);
        
        const order = orders.find(o => o.orderNumber === orderNumber);

        if (!order) {
            return res.status(404).json({
                success: false,
                message: 'Order not found'
            });
        }

        res.json({
            success: true,
            order: order
        });
    } catch (error) {
        console.error('[Order Controller] Error fetching order:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch order'
        });
    }
};

// Get all orders
exports.getAllOrders = async (req, res) => {
    try {
        const { email, status, paymentStatus, startDate, endDate, sort } = req.query;
        
        // TODO: Use Order model to query database with filters
        // let query = {};
        // if (email) query['customer.email'] = email;
        // if (status) query.status = status;
        // if (paymentStatus) query.paymentStatus = paymentStatus;
        // const orders = await Order.findAll(query);
        
        let filteredOrders = [...orders];
        
        if (email) {
            filteredOrders = filteredOrders.filter(o => o.customer.email === email);
        }
        
        if (status) {
            filteredOrders = filteredOrders.filter(o => o.status === status);
        }
        
        // Sort
        if (sort === 'oldest') {
            filteredOrders.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
        } else {
            filteredOrders.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
        }

        res.json({
            success: true,
            orders: filteredOrders,
            count: filteredOrders.length
        });
    } catch (error) {
        console.error('[Order Controller] Error fetching orders:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch orders'
        });
    }
};

// Update order status
exports.updateOrderStatus = async (req, res) => {
    try {
        const { orderNumber } = req.params;
        const { status, notes } = req.body;

        const validStatuses = ['pending', 'confirmed', 'packed', 'shipped', 'delivered', 'cancelled', 'returned'];
        if (!validStatuses.includes(status)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid status'
            });
        }

        // TODO: Use Order model to update status
        // const order = await Order.updateStatus(orderNumber, status, notes);
        
        const order = orders.find(o => o.orderNumber === orderNumber);
        if (!order) {
            return res.status(404).json({
                success: false,
                message: 'Order not found'
            });
        }

        order.status = status;
        order.updatedAt = new Date().toISOString();
        
        // Add to history
        if (!order.history) {
            order.history = [];
        }
        order.history.push({
            status,
            notes: notes || '',
            updatedAt: new Date().toISOString()
        });

        console.log(`[Order Controller] Order ${orderNumber} status updated to: ${status}`);

        res.json({
            success: true,
            order: order,
            message: 'Order status updated'
        });
    } catch (error) {
        console.error('[Order Controller] Error updating order status:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to update order status'
        });
    }
};

// Update tracking information
exports.updateTracking = async (req, res) => {
    try {
        const { orderNumber } = req.params;
        const { trackingNumber, courier } = req.body;
        
        // TODO: Use Order model to update tracking
        const order = orders.find(o => o.orderNumber === orderNumber);
        if (!order) {
            return res.status(404).json({
                success: false,
                message: 'Order not found'
            });
        }
        
        order.trackingNumber = trackingNumber;
        order.courier = courier;
        order.updatedAt = new Date().toISOString();
        
        res.json({
            success: true,
            order: order,
            message: 'Tracking information updated'
        });
    } catch (error) {
        console.error('[Order Controller] Error updating tracking:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to update tracking information'
        });
    }
};

// Add order note
exports.addOrderNote = async (req, res) => {
    try {
        const { orderNumber } = req.params;
        const { note } = req.body;
        
        // TODO: Use Order model to add note
        const order = orders.find(o => o.orderNumber === orderNumber);
        if (!order) {
            return res.status(404).json({
                success: false,
                message: 'Order not found'
            });
        }
        
        if (!order.notes) {
            order.notes = [];
        }
        
        order.notes.push({
            note,
            createdAt: new Date().toISOString(),
            createdBy: 'admin' // TODO: Get from authenticated user
        });
        
        res.json({
            success: true,
            order: order,
            message: 'Note added successfully'
        });
    } catch (error) {
        console.error('[Order Controller] Error adding note:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to add note'
        });
    }
};

// Export orders array for testing/development
exports.orders = orders;


