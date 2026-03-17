const express = require('express');
const router = express.Router();
const productController = require('../controllers/product.controller');

// Product Details Page (SSR)
// SEO-friendly product URLs: /product/rolex-submariner-aaa
router.get('/:slug', productController.renderProductDetails);

module.exports = router;
