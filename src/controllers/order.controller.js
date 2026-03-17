// Order Controller
const Order = require('../models/Order.model');
const Payment = require('../models/Payment.model');
const orderService = require('../services/order.service');

// Order counter for generating unique order numbers
let orderCounter = 1000;

/**
 * Helper function to enrich order with payment status from Payment model
 * This ensures orders.ejs uses the same payment status source as payments.ejs
 */
async function enrichOrderWithPaymentStatus(order) {
    const orderObj = order.toObject ? order.toObject() : order;
    
    // Find payment for this order (Payment model is source of truth)
    const payment = await Payment.findByOrderNumber(orderObj.orderNumber);
    
    // Use payment status from Payment model if available
    if (payment) {
        orderObj.paymentStatus = payment.status; // Use Payment model status (source of truth)
        orderObj.paymentTransactionId = payment.transactionId || payment.lencoTransactionId;
        orderObj.paymentLencoStatus = payment.lencoStatus;
        orderObj.paymentCompletedAt = payment.completedAt;
        orderObj.paymentFailedAt = payment.failedAt;
    }
    
    return orderObj;
}

// Create a new order
exports.createOrder = async (req, res) => {
    try {
        const { validateOrder, sanitizeObject } = require('../utils/validators');
        
        // Debug: Log incoming request body structure
        console.log('[Order Controller] Incoming request body keys:', Object.keys(req.body || {}));
        console.log('[Order Controller] Items in request:', req.body?.items ? `Array with ${req.body.items.length} items` : 'undefined or not array');
        
        // Sanitize input
        const sanitizedBody = sanitizeObject(req.body);
        const {
            customer,
            shipping,
            paymentMethod,
            items,
            totals,
            coupon
        } = sanitizedBody;
        
        // Debug: Log after sanitization
        console.log('[Order Controller] Items after sanitization:', items ? `Array with ${items.length} items` : 'undefined or not array');

        // Validate order data using validator
        const validation = validateOrder(sanitizedBody);
        if (!validation.valid) {
            return res.status(400).json({
                success: false,
                message: 'Validation failed',
                errors: validation.errors
            });
        }

        // Additional validation: Ensure items exists and is an array
        if (!items || !Array.isArray(items) || items.length === 0) {
            return res.status(400).json({
                success: false,
                message: 'Items are required and must be a non-empty array',
                errors: ['At least one item is required in the order']
            });
        }

        // CRITICAL: Validate and recalculate prices server-side to prevent manipulation
        const productService = require('../services/product.service');
        const { calculateFinalPrice, calculateSubtotal, calculateTotal } = require('../utils/price.utils');
        
        // Track stock validation errors
        const stockErrors = [];
        
        // Recalculate prices from database and validate stock
        const validatedItems = await Promise.all(items.map(async (item) => {
            // Find product in database using product service
            const productId = item.id || item.productId;
            if (!productId) {
                throw new Error('Product ID is required for item');
            }
            
            const product = await productService.getProductById(productId);
            
            if (!product) {
                throw new Error(`Product ${productId} not found`);
            }
            
            // Convert Mongoose document to plain object if needed
            const productObj = product.toObject ? product.toObject() : product;
            
            // CRITICAL: Validate stock availability
            const requestedQuantity = Math.max(1, parseInt(item.quantity) || 1);
            
            if (productObj.stock < requestedQuantity) {
                stockErrors.push({
                    productId: productObj._id,
                    productName: productObj.model,
                    requestedQuantity: requestedQuantity,
                    availableStock: productObj.stock,
                    message: `Only ${productObj.stock} item${productObj.stock !== 1 ? 's' : ''} available for "${productObj.model}"`
                });
                
                // Reject order if stock insufficient
                throw new Error(`Insufficient stock for "${productObj.model}". Available: ${productObj.stock}, Requested: ${requestedQuantity}`);
            }
            
            // Calculate server-side price (ignore client-provided price)
            const originalPrice = productObj.price || 0;
            const discount = productObj.discount || 0;
            const serverPrice = calculateFinalPrice(originalPrice, discount);
            
            // Warn if client price doesn't match server price
            const clientPrice = parseFloat(item.price) || 0;
            if (Math.abs(clientPrice - serverPrice) > 0.01) {
                console.warn(`[Order Controller] Price mismatch for product ${productId}: client=${clientPrice}, server=${serverPrice}`);
            }
            
            return {
                id: item.id || productObj._id.toString(),
                name: item.name || productObj.model,
                price: serverPrice, // Use server-calculated price
                originalPrice: originalPrice,
                discount: discount,
                quantity: requestedQuantity,
                image: item.image || (productObj.images && productObj.images[0]) || null,
                productId: productObj._id.toString(),
                sku: productObj.sku || null,
                stock: productObj.stock // Include for reference
            };
        }));
        
        // If any stock errors occurred, return error response
        if (stockErrors.length > 0) {
            return res.status(400).json({
                success: false,
                message: 'Some items are out of stock',
                errors: stockErrors
            });
        }
        
        // Recalculate totals server-side using utility functions
        const subtotal = calculateSubtotal(validatedItems);
        const deliveryFee = totals.delivery || 0;
        const couponDiscount = totals.discount || 0;
        const total = calculateTotal(subtotal, couponDiscount, deliveryFee);
        
        // Generate order number
        const orderNumber = `ORD-${Date.now()}-${orderCounter++}`;

        // Create order object with server-validated prices
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
            items: validatedItems, // Use server-validated items
            totals: {
                subtotal: subtotal, // Server-calculated
                discount: couponDiscount,
                delivery: deliveryFee,
                total: total // Server-calculated
            },
            coupon: coupon || null,
            status: 'pending',
            paymentStatus: 'pending', // Initialize payment status
            history: [{
                status: 'pending',
                paymentStatus: 'pending',
                notes: 'Order created',
                updatedBy: 'system',
                updatedAt: new Date().toISOString(),
                source: 'order_creation'
            }],
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };

        // Save order to database using Order model
        const order = await Order.create(orderData);
        
        // TODO: In production, use optimistic locking to reserve stock:
        // const updated = await Product.findOneAndUpdate(
        //     { _id: productId, stock: { $gte: quantity } },
        //     { $inc: { stock: -quantity, reserved: quantity } },
        //     { new: true }
        // );
        // if (!updated) {
        //     return res.status(409).json({
        //         success: false,
        //         message: 'Stock no longer available'
        //     });
        // }

        console.log(`[Order Controller] Order created: ${orderNumber}`);
        console.log(`[Order Controller] Stock validation passed for all items`);

        // Send new order notification to admin (if enabled)
        try {
            const emailService = require('../services/email.service');
            const orderObj = order.toObject ? order.toObject() : order;
            await emailService.sendOrderNotificationToAdmin(orderObj);
        } catch (emailError) {
            console.error('[Order Controller] Error sending new order notification:', emailError);
            // Continue even if email fails - don't block order creation
        }

        res.json({
            success: true,
            orderNumber: order.orderNumber,
            order: order.toObject ? order.toObject() : order,
            message: 'Order created successfully'
        });
    } catch (error) {
        console.error('[Order Controller] Error creating order:', error);
        console.error('[Order Controller] Error stack:', error.stack);
        
        // Return more detailed error message for debugging
        const errorMessage = error.message || 'Failed to create order. Please try again.';
        
        res.status(500).json({
            success: false,
            message: errorMessage,
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

// Get order by order number
exports.getOrderByNumber = async (req, res) => {
    try {
        const { orderNumber } = req.params;
        
        // Query database using Order model
        const order = await Order.findByOrderNumber(orderNumber);

        if (!order) {
            return res.status(404).json({
                success: false,
                message: 'Order not found'
            });
        }

        // Enrich order with payment status from Payment model (source of truth)
        // This ensures orders.ejs shows the same payment status as payments.ejs
        const enrichedOrder = await enrichOrderWithPaymentStatus(order);

        res.json({
            success: true,
            order: enrichedOrder
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
        const { email, status, paymentStatus, paymentMethod, startDate, endDate, sort, search, updatedSince } = req.query;
        
        // NOTE: Original implementation used Mongo-style queries. This is a simplified
        // Sequelize-compatible version that returns all orders with basic sorting.
        const orderDirection = sort === 'oldest' ? 'ASC' : 'DESC';
        const filteredOrders = await Order.findAll({
            order: [['createdAt', orderDirection]]
        });

        // Fetch payment status from Payment model for each order (source of truth)
        // This ensures orders.ejs shows the same payment status as payments.ejs
        const ordersWithPaymentStatus = await Promise.all(
            filteredOrders.map(order => enrichOrderWithPaymentStatus(order))
        );

        res.json({
            success: true,
            orders: ordersWithPaymentStatus,
            count: ordersWithPaymentStatus.length
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

        // Update order status using Order model
        const order = await Order.updateStatus(orderNumber, status, notes, 'admin');
        
        if (!order) {
            return res.status(404).json({
                success: false,
                message: 'Order not found'
            });
        }

        console.log(`[Order Controller] Order ${orderNumber} status updated to: ${status}`);

        res.json({
            success: true,
            order: order.toObject ? order.toObject() : order,
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
        
        // Update tracking using Order model
        const order = await Order.findByOrderNumber(orderNumber);
        if (!order) {
            return res.status(404).json({
                success: false,
                message: 'Order not found'
            });
        }
        
        await order.updateTracking(trackingNumber, courier);
        
        res.json({
            success: true,
            order: order.toObject ? order.toObject() : order,
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
        
        // Add note using Order model
        const order = await Order.findByOrderNumber(orderNumber);
        if (!order) {
            return res.status(404).json({
                success: false,
                message: 'Order not found'
            });
        }
        
        await order.addNote(note, 'admin'); // TODO: Get from authenticated user
        
        res.json({
            success: true,
            order: order.toObject ? order.toObject() : order,
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

/**
 * Update Order Status Based on Payment Status
 * Called from payment webhook handler to update order when payment status changes
 * 
 * This is a wrapper that delegates to orderService to avoid circular dependencies.
 * The actual implementation is in order.service.js
 * 
 * @param {string} orderNumber - Order number
 * @param {string} paymentStatus - Payment status from Lenco (pending, processing, completed, failed, cancelled)
 * @param {string} transactionId - Payment transaction ID (optional)
 * @param {string} notes - Additional notes (optional)
 * @returns {Promise<object|null>} Updated order or null if not found
 */
exports.updateOrderStatusFromPayment = async function(orderNumber, paymentStatus, transactionId = null, notes = '') {
    return orderService.updateOrderStatusFromPayment(orderNumber, paymentStatus, transactionId, notes);
};

/**
 * Verify Payment for Order
 * Verifies payment status for an order and updates order status accordingly
 * 
 * @param {string} orderNumber - Order number to verify payment for
 * @returns {Promise<object>} Verification result with payment and order status
 */
exports.verifyOrderPayment = async (req, res) => {
    try {
        const { orderNumber } = req.params;
        
        if (!orderNumber) {
            return res.status(400).json({
                success: false,
                message: 'Order number is required'
            });
        }

        // Find order
        const order = await Order.findByOrderNumber(orderNumber);
        
        if (!order) {
            return res.status(404).json({
                success: false,
                message: 'Order not found'
            });
        }

        // Find payment record for this order
        const Payment = require('../models/Payment.model');
        let payment = await Payment.findByOrderNumber(orderNumber);
        
        if (!payment) {
            return res.status(404).json({
                success: false,
                message: 'Payment record not found for this order',
                order: {
                    orderNumber: order.orderNumber,
                    status: order.status,
                    paymentStatus: order.paymentStatus
                }
            });
        }

        // If it's a Lenco payment, verify with Lenco API
        let verified = false;
        let verificationError = null;
        
        if (payment.lencoTransactionId || payment.lencoReference) {
            try {
                const lencoService = require('../services/lenco.service');
                
                // Verify payment with Lenco API
                const verificationResult = await lencoService.verifyPayment(
                    payment.lencoTransactionId,  // Collection ID (for Option B)
                    payment.lencoReference       // Reference (for Option A - recommended)
                );
                
                // Update payment record with latest status
                const previousPaymentStatus = payment.status;
                payment.lencoStatus = verificationResult.status;
                payment.status = payment.mapLencoStatusToPaymentStatus(verificationResult.status);
                payment.lencoResponse = verificationResult.rawResponse || verificationResult;
                
                if (verificationResult.completedAt) {
                    payment.completedAt = new Date(verificationResult.completedAt);
                }
                if (verificationResult.failedAt) {
                    payment.failedAt = new Date(verificationResult.failedAt);
                    payment.failureReason = verificationResult.failureReason;
                }
                
                await payment.save();
                verified = true;
                
                console.log(`[Order Controller] Payment ${payment.transactionId || payment.lencoTransactionId} verified for order ${orderNumber}. Status: ${previousPaymentStatus} → ${payment.status}`);
                
            } catch (error) {
                console.error('[Order Controller] Error verifying payment with Lenco:', error);
                verificationError = error.message;
                // Continue with database status if verification fails
            }
        } else {
            // Non-Lenco payment, use database status
            verified = true;
        }

        // Update order status based on payment status
        const previousOrderStatus = order.status;
        const previousOrderPaymentStatus = order.paymentStatus;
        
        const updatedOrder = await orderService.updateOrderStatusFromPayment(
            orderNumber,
            payment.status,
            payment.transactionId || payment.lencoTransactionId,
            verified ? 'Payment verified successfully' : 'Payment verification attempted (gateway verification failed, using database status)'
        );

        if (!updatedOrder) {
            console.warn(`[Order Controller] Failed to update order status for ${orderNumber}`);
        }

        // Return verification result
        res.json({
            success: true,
            verified: verified,
            verificationError: verificationError,
            order: {
                orderNumber: updatedOrder ? updatedOrder.orderNumber : order.orderNumber,
                status: updatedOrder ? updatedOrder.status : order.status,
                previousStatus: previousOrderStatus,
                paymentStatus: updatedOrder ? updatedOrder.paymentStatus : order.paymentStatus,
                previousPaymentStatus: previousOrderPaymentStatus
            },
            payment: {
                transactionId: payment.transactionId || payment.lencoTransactionId,
                status: payment.status,
                lencoStatus: payment.lencoStatus,
                paymentMethod: payment.paymentMethod,
                amount: payment.amount,
                currency: payment.currency
            },
            message: verified 
                ? 'Payment verified successfully' 
                : 'Payment record found, but gateway verification failed. Using database status.'
        });

    } catch (error) {
        console.error('[Order Controller] Error verifying order payment:', error);
        res.status(500).json({
            success: false,
            message: error.message || 'Failed to verify order payment'
        });
    }
};

/**
 * Generate Invoice PDF
 * Generates and returns a PDF invoice for an order
 */
exports.generateInvoice = async (req, res) => {
    try {
        const { orderNumber } = req.params;
        
        if (!orderNumber) {
            return res.status(400).json({
                success: false,
                message: 'Order number is required'
            });
        }

        // Find order
        const order = await Order.findByOrderNumber(orderNumber);
        
        if (!order) {
            return res.status(404).json({
                success: false,
                message: 'Order not found'
            });
        }

        // Generate PDF invoice
        const invoiceService = require('../services/invoice.service');
        const pdfBuffer = await invoiceService.generateInvoicePDF(order);

        // Set response headers for PDF download
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="Invoice-${orderNumber}.pdf"`);
        res.setHeader('Content-Length', pdfBuffer.length);

        // Send PDF
        res.send(pdfBuffer);

        console.log(`[Order Controller] Invoice generated for order ${orderNumber}`);
    } catch (error) {
        console.error('[Order Controller] Error generating invoice:', error);
        res.status(500).json({
            success: false,
            message: error.message || 'Failed to generate invoice'
        });
    }
};

/**
 * Send Invoice Email
 * Generates invoice PDF and sends it to customer via email
 */
/**
 * Delete Order (Soft Delete)
 * Sets order status to 'cancelled' and adds deletion note
 */
exports.deleteOrder = async (req, res) => {
    try {
        const { orderNumber } = req.params;
        
        if (!orderNumber) {
            return res.status(400).json({
                success: false,
                message: 'Order number is required'
            });
        }
        
        // Use Order model's delete method (soft delete)
        const order = await Order.delete(orderNumber);
        
        if (!order) {
            return res.status(404).json({
                success: false,
                message: 'Order not found'
            });
        }
        
        console.log(`[Order Controller] Order ${orderNumber} deleted (soft delete)`);
        
        res.json({
            success: true,
            message: 'Order deleted successfully',
            order: order.toObject ? order.toObject() : order
        });
    } catch (error) {
        console.error('[Order Controller] Error deleting order:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to delete order',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

/**
 * Delete Multiple Orders (Bulk Delete)
 * Deletes multiple orders by their order numbers
 */
exports.deleteOrders = async (req, res) => {
    try {
        const { orderNumbers } = req.body;
        
        if (!orderNumbers || !Array.isArray(orderNumbers) || orderNumbers.length === 0) {
            return res.status(400).json({
                success: false,
                message: 'Order numbers array is required'
            });
        }
        
        const results = {
            deleted: [],
            notFound: [],
            errors: []
        };
        
        // Delete each order
        for (const orderNumber of orderNumbers) {
            try {
                const order = await Order.delete(orderNumber);
                if (order) {
                    results.deleted.push(orderNumber);
                } else {
                    results.notFound.push(orderNumber);
                }
            } catch (error) {
                console.error(`[Order Controller] Error deleting order ${orderNumber}:`, error);
                results.errors.push({ orderNumber, error: error.message });
            }
        }
        
        console.log(`[Order Controller] Bulk delete completed: ${results.deleted.length} deleted, ${results.notFound.length} not found, ${results.errors.length} errors`);
        
        res.json({
            success: true,
            message: `Deleted ${results.deleted.length} order(s)`,
            results: results
        });
    } catch (error) {
        console.error('[Order Controller] Error in bulk delete:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to delete orders',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

exports.sendInvoiceEmail = async (req, res) => {
    try {
        const { orderNumber } = req.params;
        const { cc, bcc } = req.body; // Optional CC and BCC recipients
        
        if (!orderNumber) {
            return res.status(400).json({
                success: false,
                message: 'Order number is required'
            });
        }

        // Find order
        const order = await Order.findByOrderNumber(orderNumber);
        
        if (!order) {
            return res.status(404).json({
                success: false,
                message: 'Order not found'
            });
        }

        // Validate customer email
        if (!order.customer.email) {
            return res.status(400).json({
                success: false,
                message: 'Customer email is required to send invoice'
            });
        }

        // Generate PDF invoice
        const invoiceService = require('../services/invoice.service');
        const pdfBuffer = await invoiceService.generateInvoicePDF(order);

        // Send email with PDF attachment
        const emailService = require('../services/email.service');
        const emailResult = await emailService.sendInvoiceEmail(order, pdfBuffer, { cc, bcc });

        if (!emailResult.success) {
            return res.status(500).json({
                success: false,
                message: emailResult.error || 'Failed to send invoice email'
            });
        }

        console.log(`[Order Controller] Invoice email sent for order ${orderNumber} to ${order.customer.email}`);

        res.json({
            success: true,
            message: 'Invoice email sent successfully',
            recipient: order.customer.email,
            messageId: emailResult.messageId
        });
    } catch (error) {
        console.error('[Order Controller] Error sending invoice email:', error);
        res.status(500).json({
            success: false,
            message: error.message || 'Failed to send invoice email'
        });
    }
};

/**
 * Export orders to CSV or JSON
 * GET /api/admin/orders/export
 * 
 * Query params:
 * - format: 'csv' | 'json' (default: 'csv')
 * - Same filters as GET /api/admin/orders
 */
exports.exportOrders = async (req, res) => {
    try {
        const format = (req.query.format || 'csv').toLowerCase();
        const {
            email,
            status,
            paymentStatus,
            paymentMethod,
            startDate,
            endDate,
            search,
            sort
        } = req.query;

        // Validate format
        if (format !== 'csv' && format !== 'json') {
            return res.status(400).json({
                success: false,
                message: 'Invalid format. Must be: csv or json.'
            });
        }

        // Build filters object
        const filters = {
            email: email || undefined,
            status: status || undefined,
            paymentStatus: paymentStatus || undefined,
            paymentMethod: paymentMethod || undefined,
            startDate: startDate || undefined,
            endDate: endDate || undefined,
            search: search?.trim() || undefined,
            sort: sort || 'newest'
        };

        // Remove undefined values
        Object.keys(filters).forEach(key => {
            if (filters[key] === undefined) {
                delete filters[key];
            }
        });

        // Get orders for export
        const orderService = require('../services/order.service');
        const orders = await orderService.getOrdersForExport(filters);

        if (orders.length === 0) {
            return res.status(400).json({
                success: false,
                message: 'No orders to export'
            });
        }

        const exportDate = new Date().toISOString().split('T')[0];
        const exportTime = new Date().toISOString();

        if (format === 'json') {
            // Export as JSON
            const exportData = {
                exportDate: exportDate,
                exportTime: exportTime,
                statistics: {
                    totalOrders: orders.length,
                    totalValue: orders.reduce((sum, order) => sum + (order.totals?.total || 0), 0),
                    byStatus: orders.reduce((acc, order) => {
                        acc[order.status] = (acc[order.status] || 0) + 1;
                        return acc;
                    }, {}),
                    byPaymentStatus: orders.reduce((acc, order) => {
                        acc[order.paymentStatus] = (acc[order.paymentStatus] || 0) + 1;
                        return acc;
                    }, {})
                },
                filters: filters,
                orders: orders.map(order => ({
                    orderNumber: order.orderNumber,
                    orderDate: order.createdAt,
                    customer: {
                        name: order.customer.name,
                        email: order.customer.email,
                        phone: order.customer.phone
                    },
                    shipping: {
                        address: order.shipping?.address || '',
                        city: order.shipping?.city || '',
                        province: order.shipping?.province || '',
                        pickup: order.shipping?.pickup || false
                    },
                    items: order.items.map(item => ({
                        name: item.name,
                        quantity: item.quantity,
                        price: item.price,
                        total: item.price * item.quantity
                    })),
                    totals: {
                        subtotal: order.totals?.subtotal || 0,
                        discount: order.totals?.discount || 0,
                        delivery: order.totals?.delivery || 0,
                        total: order.totals?.total || 0
                    },
                    paymentMethod: order.paymentMethod,
                    paymentStatus: order.paymentStatus,
                    status: order.status,
                    trackingNumber: order.trackingNumber || '',
                    courier: order.courier || '',
                    transactionId: order.paymentTransactionId || order.transactionId || ''
                }))
            };

            res.setHeader('Content-Type', 'application/json');
            res.setHeader('Content-Disposition', `attachment; filename="orders_export_${exportDate}.json"`);
            res.json(exportData);
        } else {
            // Export as CSV
            const escapeCsvCell = (cell) => {
                if (cell === null || cell === undefined) return '';
                const str = String(cell);
                // Escape quotes and wrap in quotes if contains comma, newline, or quote
                if (str.includes(',') || str.includes('\n') || str.includes('"')) {
                    return `"${str.replace(/"/g, '""')}"`;
                }
                return str;
            };

            // CSV Headers
            const headers = [
                'Order Number',
                'Order Date',
                'Customer Name',
                'Customer Email',
                'Customer Phone',
                'Shipping Address',
                'City',
                'Province',
                'Pickup',
                'Items (Name x Qty)',
                'Subtotal',
                'Discount',
                'Delivery Fee',
                'Total',
                'Payment Method',
                'Payment Status',
                'Order Status',
                'Tracking Number',
                'Courier',
                'Transaction ID'
            ];

            // Convert orders to CSV rows
            const orderRows = orders.map(order => {
                const itemsText = order.items.map(item => 
                    `${item.name} x ${item.quantity}`
                ).join('; ');
                
                return [
                    order.orderNumber,
                    new Date(order.createdAt).toLocaleString('en-US'),
                    order.customer.name,
                    order.customer.email,
                    order.customer.phone,
                    order.shipping?.address || '',
                    order.shipping?.city || '',
                    order.shipping?.province || '',
                    order.shipping?.pickup ? 'Yes' : 'No',
                    itemsText,
                    order.totals?.subtotal || 0,
                    order.totals?.discount || 0,
                    order.totals?.delivery || 0,
                    order.totals?.total || 0,
                    orderService.formatPaymentMethod(order.paymentMethod),
                    order.paymentStatus || 'pending',
                    order.status,
                    order.trackingNumber || '',
                    order.courier || '',
                    order.paymentTransactionId || order.transactionId || ''
                ];
            });

            // Statistics rows (for CSV header)
            const totalValue = orders.reduce((sum, order) => sum + (order.totals?.total || 0), 0);
            const statsRows = [
                ['Export Date', exportDate],
                ['Export Time', exportTime],
                ['Total Orders', orders.length],
                ['Total Value', `K${orderService.formatCurrency(totalValue)}`],
                [''], // Empty row
                ['Statistics by Status'],
                ...Object.entries(orders.reduce((acc, order) => {
                    acc[order.status] = (acc[order.status] || 0) + 1;
                    return acc;
                }, {})).map(([status, count]) => [status, count]),
                [''], // Empty row
                ['Statistics by Payment Status'],
                ...Object.entries(orders.reduce((acc, order) => {
                    acc[order.paymentStatus] = (acc[order.paymentStatus] || 0) + 1;
                    return acc;
                }, {})).map(([status, count]) => [status, count]),
                [''] // Empty row before headers
            ];

            // Combine all rows
            const csvContent = [
                ...statsRows.map(row => row.map(escapeCsvCell).join(',')),
                headers.map(escapeCsvCell).join(','),
                ...orderRows.map(row => row.map(escapeCsvCell).join(','))
            ].join('\n');

            res.setHeader('Content-Type', 'text/csv');
            res.setHeader('Content-Disposition', `attachment; filename="orders_export_${exportDate}.csv"`);
            res.send(csvContent);
        }
    } catch (error) {
        console.error('[Order Controller] Error exporting orders:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to export orders data'
        });
    }
};

// Export Order model for testing/development
exports.Order = Order;

