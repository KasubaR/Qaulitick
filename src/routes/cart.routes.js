// Cart Routes
// CANONICAL FILE: src/routes/cart.routes.js
// This is the only cart routes file - do not create duplicates
// Referenced in: src/app.js line 204 and 446
const express = require('express');
const router = express.Router();
const cartController = require('../controllers/cart.controller');

// Add item to cart (with stock validation)
router.post('/add', cartController.addToCart);

// Update cart item quantity (with stock validation)
router.patch('/update', cartController.updateCartItem);

// Remove item from cart
router.delete('/remove/:itemId', cartController.removeFromCart);

// Get cart items (with size limits to prevent DoS)
// NOTE: For large carts, use POST /api/cart/validate instead
router.get('/items', cartController.getCartItems);

// Validate cart items and return authoritative prices (SECURITY: prevents price manipulation)
router.post('/validate', cartController.validateCart);

module.exports = router;

