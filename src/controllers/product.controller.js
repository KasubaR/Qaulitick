// Product Controller - Updated with Database Integration
const { UniqueConstraintError } = require('sequelize');
const productService = require('../services/product.service');
const { calculateSavings, getSellingUnitPrice } = require('../utils/price.utils');
const { clearCache } = require('../middlewares/cache.middleware');
const { getStockStatus } = require('../utils/stock.utils');

/**
 * Convert a Sequelize model instance to a plain object.
 * Sequelize uses .get({ plain: true }) or .toJSON(); .toObject() is Mongoose-only and would throw.
 */
function toPlain(instance) {
    if (instance == null) return instance;
    if (typeof instance.get === 'function') return instance.get({ plain: true });
    if (typeof instance.toJSON === 'function') return instance.toJSON();
    return instance;
}

/**
 * Normalize a product plain object so that JSON fields (images, colors, strapOptions, reviews)
 * are always JavaScript arrays, not raw JSON strings.
 * MySQL JSON columns are parsed by Sequelize but can occasionally come back as strings.
 */
function normalizeProduct(productObj) {
    if (productObj.id != null && productObj._id == null) productObj._id = productObj.id;
    const jsonArrayFields = ['images', 'colors', 'strapOptions', 'reviews'];
    jsonArrayFields.forEach(field => {
        if (typeof productObj[field] === 'string') {
            try { productObj[field] = JSON.parse(productObj[field]); } catch (e) { productObj[field] = []; }
        }
        if (!Array.isArray(productObj[field])) productObj[field] = [];
    });
    return productObj;
}

/**
 * Attach correct price fields to a normalised product plain object.
 *   price         = current selling price (from DB)
 *   originalPrice = pre-discount price    (from DB; equals price when no discount)
 *   finalPrice    = same as price         (for template compatibility)
 *   savings       = originalPrice - price
 */
function withPrices(productObj) {
    const currentPrice   = Number(productObj.price) || 0;
    const storedOriginal = Number(productObj.originalPrice) || 0;
    const origPrice      = storedOriginal > currentPrice ? storedOriginal : currentPrice;
    const discount       = productObj.discount || 0;
    const savings        = origPrice > currentPrice
        ? Math.round(origPrice - currentPrice)
        : calculateSavings(origPrice, discount);
    // For products with named color variants, derive stock from color-level stocks
    // so the badge always reflects actual per-color availability, not a stale aggregate.
    let stockBase = Number(productObj.stock) || 0;
    if (Array.isArray(productObj.colors)) {
        const namedColors = productObj.colors.filter(c => c && typeof c.name === 'string' && c.name.trim());
        if (namedColors.length > 0) {
            stockBase = namedColors.reduce((sum, c) => {
                const n = parseInt(c.stock, 10);
                return sum + (Number.isNaN(n) || n < 0 ? 0 : n);
            }, 0);
        }
    }
    const availableStock = Math.max(0, stockBase);
    const stockStatus    = getStockStatus(availableStock, productObj.lowStockThreshold);
    return { ...productObj, price: currentPrice, originalPrice: origPrice, finalPrice: currentPrice, savings, availableStock, stockStatus };
}

/**
 * Build the Schema.org CollectionPage + ItemList JSON-LD object for the shop page.
 * Products must already be normalised (images is an array).
 */
function buildShopLd(products, canonicalUrl) {
    return {
        '@context': 'https://schema.org',
        '@type': 'CollectionPage',
        name: 'Luxury Watch Collection',
        description: 'Shop premium triple-A luxury watches from top brands',
        url: canonicalUrl,
        mainEntity: {
            '@type': 'ItemList',
            numberOfItems: products.length,
            itemListElement: products.map((p, index) => ({
                '@type': 'ListItem',
                position: index + 1,
                item: {
                    '@type': 'Product',
                    name: p.model,
                    url: `https://qualitick-collections.com/product/${p._id}`,
                    image: p.images[0] || '/images/placeholder.jpg',
                    brand: { '@type': 'Brand', name: p.brand },
                    offers: {
                        '@type': 'Offer',
                        price: String(p.price),
                        priceCurrency: 'ZMW',
                        availability: (p.availableStock || 0) > 0 ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock'
                    }
                }
            }))
        }
    };
}

/**
 * Validate product ID (positive integer). Sequelize PKs are integers; !parseInt(id) wrongly rejects 0 and is loose for non-numeric strings.
 */
function isValidId(id) {
    const n = Number(id);
    return Number.isInteger(n) && n > 0;
}

/**
 * Get all products (API endpoint)
 * GET /api/products
 */
exports.getProductsAPI = async (req, res) => {
    try {
        const { sanitizeObject } = require('../utils/validators');
        
        // Sanitize query parameters
        // Note: validateQueryParams is already handled by security middleware
        const sanitizedQuery = sanitizeObject(req.query);
        
        // Extract pagination parameters
        const currentPage = parseInt(sanitizedQuery.page) || 1;
        const limit = parseInt(sanitizedQuery.limit) || 12;
        const skip = (currentPage - 1) * limit;
        
        // Extract filter parameters
        // For admin: if status is explicitly 'all' or not provided, show all products
        // For shop: default to 'active' only
        const statusFilter = sanitizedQuery.status;
        const filters = {
            brand: sanitizedQuery.brand,
            gender: sanitizedQuery.gender,
            movement: sanitizedQuery.movement,
            strap: sanitizedQuery.strap,
            minPrice: sanitizedQuery.minPrice,
            maxPrice: sanitizedQuery.maxPrice,
            minRating: sanitizedQuery.minRating,
            inStockOnly: sanitizedQuery.inStockOnly,
            lowStock: sanitizedQuery.lowStock,
            sortBy: sanitizedQuery.sortBy || 'newest',
            status: statusFilter === 'all' ? undefined : (statusFilter || 'active')
        };
        
        // Get total count for pagination (before applying skip/limit)
        const totalProducts = await productService.getProductCount(filters);
        
        // Get paginated products from database
        const products = await productService.filterProducts(filters, {
            skip: skip,
            limit: limit
        });
        
        // Ensure products is always an array (safety check)
        const productsArray = Array.isArray(products) ? products : [];
        
        // Calculate prices for all products
        const productsWithPrices = productsArray.map(product =>
            withPrices(normalizeProduct(toPlain(product)))
        );
        
        // Calculate pagination values
        const totalPages = Math.ceil(totalProducts / limit);
        const pagination = {
            currentPage: currentPage,
            totalPages: totalPages || 0,
            totalProducts: totalProducts,
            limit: limit,
            hasNextPage: currentPage < totalPages,
            hasPrevPage: currentPage > 1
        };
        
        res.json({
            success: true,
            count: productsWithPrices.length,
            products: productsWithPrices,
            pagination: pagination
        });
    } catch (error) {
        console.error('[Product Controller] Error fetching products:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch products',
            products: [] // Always include empty array even on error
        });
    }
};

/**
 * Get single product details (API endpoint)
 * GET /api/products/:id
 */
exports.getProductByIdAPI = async (req, res) => {
    try {
        const productId = req.params.id;
        
        if (!isValidId(productId)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid product ID'
            });
        }
        
        const product = await productService.getProductById(Number(productId));
        
        if (!product) {
            return res.status(404).json({
                success: false,
                message: 'Product not found'
            });
        }
        
        const productWithPrices = withPrices(normalizeProduct(toPlain(product)));

        res.json({
            success: true,
            product: productWithPrices
        });
    } catch (error) {
        console.error('[Product Controller] Error fetching product:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch product'
        });
    }
};

/**
 * Render product details page (SSR)
 * GET /product/:slug
 */
exports.renderProductDetails = async (req, res) => {
    try {
        const productSlug = req.params.slug;
        let product = null;
        
        // Check if the slug is a numeric ID
        const isNumericId = /^\d+$/.test(productSlug);

        if (isNumericId) {
            // Look up product by ID
            product = await productService.getProductById(parseInt(productSlug));
        } else {
            // Slug format is the SKU lowercased (e.g. rolex-sub-001 → ROLEX-SUB-001)
            const sku = productSlug.toUpperCase();
            product = await productService.getProductBySku(sku);
        }
        
        if (!product) {
            return res.status(404).render('404', {
                title: 'Product Not Found | Qualitick Collections',
                page: 'error',
                message: 'The product you are looking for does not exist.'
            });
        }
        
        const productObj = normalizeProduct(toPlain(product));
        
        // SEO data
        const metaDescription = productObj.description 
            ? productObj.description.substring(0, 155) + '...'
            : `${productObj.brand} ${productObj.model} - Premium AAA luxury watch with ${productObj.warranty} warranty.`;
        
        const keywords = `${productObj.brand}, ${productObj.model}, luxury watch, AAA replica, ${productObj.movement}, ${productObj.gender} watch, premium timepiece`;
        const canonicalUrl = `https://qualitick-collections.com/product/${productSlug}`;
        const ogImage = productObj.images && productObj.images[0] 
            ? productObj.images[0] 
            : 'https://qualitick-collections.com/images/default-watch.jpg';
        
        // Calculate prices
        // In the DB, productObj.price is the current selling price.
        // If originalPrice exists and is greater than the current price, use it as the "original" crossed-out price.
        const currentPrice = Number(productObj.price) || 0;
        const storedOriginal = Number(productObj.originalPrice) || 0;
        const originalPrice = storedOriginal > currentPrice ? storedOriginal : currentPrice;
        const discount = productObj.discount || 0;
        // Final price is the current selling price from the DB
        const finalPrice = currentPrice;
        // Savings is the difference between original and final, or derived from discount if needed
        const savings = originalPrice > finalPrice
            ? Math.round(originalPrice - finalPrice)
            : calculateSavings(originalPrice, discount);
        
        // Filter sensitive data from reviews (email, ipAddress)
        // Debug: Log review data
        console.log(`[Product Controller] Product ${productObj.id} - Reviews in DB:`, productObj.reviews ? productObj.reviews.length : 0);
        if (productObj.reviews && productObj.reviews.length > 0) {
            console.log(`[Product Controller] Sample review:`, {
                name: productObj.reviews[0].name,
                title: productObj.reviews[0].title,
                rating: productObj.reviews[0].rating,
                verified: productObj.reviews[0].verified
            });
        }
        
        const sanitizedReviews = (productObj.reviews || []).map(review => {
            const sanitized = { ...review };
            // Remove sensitive fields
            delete sanitized.email;
            delete sanitized.ipAddress;
            // Ensure all required fields exist for backward compatibility
            return {
                name: sanitized.name || sanitized.user || 'Anonymous',
                title: sanitized.title || '',
                comment: sanitized.comment || '',
                rating: sanitized.rating || 0,
                verified: sanitized.verified || false,
                orderNumber: sanitized.orderNumber || null,
                createdAt: sanitized.createdAt || sanitized.date || new Date(),
                // Keep old fields for backward compatibility
                user: sanitized.user || sanitized.name,
                date: sanitized.date || sanitized.createdAt || new Date()
            };
        });
        
        console.log(`[Product Controller] Sanitized reviews count:`, sanitizedReviews.length);

        const availableStock = Math.max(0, Number(productObj.stock) || 0);
        const productWithPrices = {
            ...productObj,
            originalPrice: originalPrice,
            finalPrice: finalPrice,
            savings: savings,
            reviews: sanitizedReviews,
            availableStock: availableStock,
            stockStatus: getStockStatus(availableStock, productObj.lowStockThreshold)
        };
        
        // Get related products (same brand)
        const relatedProductsRaw = await productService.getProductsByBrand(productObj.brand);
        const relatedProducts = relatedProductsRaw
            .filter(p => p.id !== product.id)
            .slice(0, 4)
            .map(p => {
                const pObj = normalizeProduct(toPlain(p));
                const pOriginalPrice = pObj.price || 0;
                const pDiscount = pObj.discount || 0;
                const pAvailable = Math.max(0, Number(pObj.stock) || 0);
                return {
                    ...pObj,
                    originalPrice: pOriginalPrice,
                    finalPrice: getSellingUnitPrice(pObj),
                    savings: calculateSavings(pOriginalPrice, pDiscount),
                    availableStock: pAvailable,
                    stockStatus: getStockStatus(pAvailable, pObj.lowStockThreshold)
                };
            });
        
        const inStock = Number.isFinite(Number(productWithPrices.stock)) && Number(productWithPrices.stock) > 0;
        const productLd = {
            '@context': 'https://schema.org/',
            '@type': 'Product',
            name: productWithPrices.model,
            image: productWithPrices.images,
            description: productWithPrices.description || '',
            sku: String(productWithPrices.sku || productWithPrices._id || ''),
            brand: { '@type': 'Brand', name: productWithPrices.brand || '' },
            offers: {
                '@type': 'Offer',
                url: canonicalUrl,
                priceCurrency: 'ZMW',
                price: String(productWithPrices.price != null ? productWithPrices.price : ''),
                priceValidUntil: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
                itemCondition: 'https://schema.org/NewCondition',
                availability: inStock ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock',
                seller: { '@type': 'Organization', name: 'Qualitick Collections' }
            },
            category: (productWithPrices.gender || '') + ' Watches',
            material: productWithPrices.caseMaterial || 'Stainless Steel',
            color: productWithPrices.color || (productWithPrices.colors[0] ? productWithPrices.colors[0].name : '') || ''
        };
        if (productWithPrices.rating) {
            productLd.aggregateRating = {
                '@type': 'AggregateRating',
                ratingValue: String(productWithPrices.rating),
                reviewCount: String(sanitizedReviews.length),
                bestRating: '5',
                worstRating: '1'
            };
        }
        if (sanitizedReviews.length > 0) {
            productLd.review = sanitizedReviews.map(review => ({
                '@type': 'Review',
                reviewRating: {
                    '@type': 'Rating',
                    ratingValue: String(review.rating != null ? review.rating : ''),
                    bestRating: '5'
                },
                author: { '@type': 'Person', name: review.name || 'Anonymous' },
                reviewBody: review.comment || '',
                datePublished: new Date(review.createdAt || review.date || Date.now()).toISOString()
            }));
        }
        const breadcrumbLd = {
            '@context': 'https://schema.org',
            '@type': 'BreadcrumbList',
            itemListElement: [
                { '@type': 'ListItem', position: 1, name: 'Home', item: 'https://qualitick-collections.com/' },
                { '@type': 'ListItem', position: 2, name: 'Shop', item: 'https://qualitick-collections.com/shop' },
                { '@type': 'ListItem', position: 3, name: productWithPrices.model || 'Product', item: canonicalUrl }
            ]
        };

        res.setHeader('Cache-Control', 'no-store');
        res.render('productdetails', {
            title: `${productObj.model} - ${productObj.brand} | Qualitick Collections`,
            page: 'product',
            product: productWithPrices,
            relatedProducts: relatedProducts,
            description: metaDescription,
            keywords: keywords,
            canonicalUrl: canonicalUrl,
            ogImage: ogImage,
            ogType: 'product',
            url: `/product/${productSlug}`,
            productLd: productLd,
            breadcrumbLd: breadcrumbLd
        });
    } catch (error) {
        console.error('[Product Controller] Error rendering product details:', error);
        const { ServerError } = require('../middlewares/error.middleware');
        throw new ServerError('An error occurred while loading the product.');
    }
};

/**
 * Generate SKU (Admin API)
 * POST /api/products/generate-sku
 */
exports.generateSKU = async (req, res) => {
    try {
        const { generateSKU } = require('../utils/sku.generator');
        const { brand, model } = req.body;
        
        if (!brand || !model) {
            return res.status(400).json({
                success: false,
                message: 'Brand and model are required to generate SKU'
            });
        }
        
        const sku = await generateSKU(brand, model);
        
        res.json({
            success: true,
            sku: sku
        });
    } catch (error) {
        console.error('[Product Controller] Error generating SKU:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to generate SKU'
        });
    }
};

/**
 * Create new product (Admin API)
 * POST /api/products
 */
exports.createProduct = async (req, res) => {
    try {
        const { validateProduct, sanitizeObject } = require('../utils/validators');
        const { generateSKU } = require('../utils/sku.generator');
        
        // Sanitize input
        const sanitizedData = sanitizeObject(req.body);
        const { normalizeProductStockFromColors } = require('../utils/productStock.utils');
        normalizeProductStockFromColors(sanitizedData);
        
        // Debug log for image URLs validation issues
        if (sanitizedData && sanitizedData.images) {
            console.log('[Product Controller] Incoming images field:', sanitizedData.images);
        }
        
        // Auto-generate SKU if not provided
        if (!sanitizedData.sku || sanitizedData.sku.trim() === '') {
            if (sanitizedData.brand && sanitizedData.model) {
                try {
                    sanitizedData.sku = await generateSKU(sanitizedData.brand, sanitizedData.model);
                } catch (error) {
                    console.error('[Product Controller] Error auto-generating SKU:', error);
                    // Continue without auto-generation, validation will catch missing SKU
                }
            }
        }
        
        // Validate product data
        const validation = validateProduct(sanitizedData);
        if (!validation.valid) {
            return res.status(400).json({
                success: false,
                message: 'Validation failed',
                errors: validation.errors
            });
        }
        
        // Create product in database
        const product = await productService.createProduct(sanitizedData);

        clearCache('/api/products');
        res.status(201).json({
            success: true,
            message: 'Product created successfully',
            product: product
        });
    } catch (error) {
        console.error('[Product Controller] Error creating product:', error);
        
        // Handle duplicate SKU error (Sequelize unique constraint)
        if (error instanceof UniqueConstraintError ||
            error.name === 'SequelizeUniqueConstraintError') {
            return res.status(409).json({
                success: false,
                message: 'Product with this SKU already exists'
            });
        }
        
        res.status(500).json({
            success: false,
            message: 'Failed to create product'
        });
    }
};

/**
 * Update product (Admin API)
 * PUT /api/products/:id
 */
exports.updateProduct = async (req, res) => {
    try {
        const { validateProduct, sanitizeObject } = require('../utils/validators');
        
        const productId = req.params.id;
        
        if (!isValidId(productId)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid product ID'
            });
        }
        
        const sanitizedData = sanitizeObject(req.body);
        const { normalizeProductStockFromColors } = require('../utils/productStock.utils');
        normalizeProductStockFromColors(sanitizedData);

        const validation = validateProduct(sanitizedData, { partial: true });
        if (!validation.valid) {
            return res.status(400).json({
                success: false,
                message: 'Validation failed',
                errors: validation.errors
            });
        }

        const product = await productService.updateProduct(Number(productId), sanitizedData);

        if (!product) {
            return res.status(404).json({
                success: false,
                message: 'Product not found'
            });
        }

        // If stock was updated to 0, check if any active flash sale should be ended
        if (product.stock !== undefined && product.stock <= 0) {
            const flashSaleService = require('../services/flashSale.service');
            await flashSaleService.endSaleIfAllOutOfStock(Number(productId));
        }

        clearCache('/api/products');
        res.json({
            success: true,
            message: 'Product updated successfully',
            product: product
        });
    } catch (error) {
        console.error('[Product Controller] Error updating product:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to update product'
        });
    }
};

/**
 * Delete product (Admin API)
 * DELETE /api/products/:id
 */
exports.deleteProduct = async (req, res) => {
    try {
        const productId = req.params.id;
        
        if (!isValidId(productId)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid product ID'
            });
        }
        
        const product = await productService.deleteProduct(Number(productId));
        
        // If product does not exist, treat as already deleted (idempotent delete)
        if (!product) {
            return res.json({
                success: true,
                message: 'Product already deleted or not found'
            });
        }
        
        // Clean up featured products that reference this deleted product
        try {
            const featuredProductService = require('../services/featuredProduct.service');
            const removedCount = await featuredProductService.cleanupDeletedProducts();
            if (removedCount > 0) {
                console.log(`[Product Controller] Cleaned up ${removedCount} featured product(s) after product deletion`);
            }
        } catch (error) {
            // Log error but don't fail the deletion
            console.error('[Product Controller] Error cleaning up featured products after deletion:', error);
        }

        // Remove the deleted product from any flash sales; end sales that become empty
        try {
            const flashSaleService = require('../services/flashSale.service');
            await flashSaleService.removeDeletedProduct(Number(productId));
        } catch (error) {
            console.error('[Product Controller] Error cleaning up flash sales after product deletion:', error);
        }

        clearCache('/api/products');
        clearCache('/api/marketing/flash-sales');
        res.json({
            success: true,
            message: 'Product deleted successfully'
        });
    } catch (error) {
        console.error('[Product Controller] Error deleting product:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to delete product'
        });
    }
};

/**
 * Render shop page (SSR)
 * GET /shop
 */
exports.renderShop = async (req, res) => {
    try {
        // Get all active products from database
        const products = await productService.getAllProducts({ status: 'active' });
        
        // Handle no products found (SSR)
        // If there are no products, render the shop page with an empty list
        // and let the frontend handle messaging. This avoids showing a
        // misleading \"No products available\" error when data is still loading.
        const canonicalUrl = 'https://qualitick-collections.com/shop';
        const description = 'Shop premium triple-A luxury watches. Browse Rolex, Omega, Tag Heuer, Cartier and more. Free worldwide shipping.';
        const keywords = 'luxury watches, AAA replica watches, premium watches, Rolex, Omega, Tag Heuer, Cartier, men watches, women watches, shop watches';

        if (!products || products.length === 0) {
            const shopLd = buildShopLd([], canonicalUrl);
            return res.render('shop', {
                title: 'Shop Luxury Watches | Qualitick Collections',
                page: 'shop',
                products: [],
                productCount: 0,
                description,
                keywords,
                canonicalUrl,
                url: '/shop',
                ogType: 'website',
                shopLd
            });
        }

        // Calculate prices for all products
        const productsWithPrices = products.map(product =>
            withPrices(normalizeProduct(toPlain(product)))
        );

        const shopLd = buildShopLd(productsWithPrices, canonicalUrl);

        res.render('shop', {
            title: 'Shop Luxury Watches | Qualitick Collections',
            page: 'shop',
            products: productsWithPrices,
            productCount: productsWithPrices.length,
            description,
            keywords,
            canonicalUrl,
            url: '/shop',
            ogType: 'website',
            shopLd
        });
    } catch (error) {
        console.error('[Product Controller] Error rendering shop page:', error);
        const { ServerError } = require('../middlewares/error.middleware');
        throw new ServerError('An error occurred while loading the shop page.');
    }
};

/**
 * Search products (API endpoint)
 * GET /api/products/search
 */
exports.searchProducts = async (req, res) => {
    try {
        let searchQuery = req.query.q;
        if (Array.isArray(searchQuery)) {
            searchQuery = searchQuery[0];
        }
        if (typeof searchQuery !== 'string') {
            searchQuery = '';
        }
        searchQuery = searchQuery.trim();

        if (!searchQuery) {
            return res.status(400).json({
                success: false,
                message: 'Search query is required'
            });
        }
        
        // Extract pagination parameters
        const currentPage = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 8;
        const skip = (currentPage - 1) * limit;
        
        // Get total count for pagination (need to count all matching products)
        const totalProducts = await productService.countSearchResults(searchQuery);
        
        // Get paginated products
        const products = await productService.searchProducts(searchQuery, {
            limit: limit,
            skip: skip
        });
        
        // Calculate prices
        const productsWithPrices = products.map(product =>
            withPrices(normalizeProduct(toPlain(product)))
        );
        
        // Calculate pagination values
        const totalPages = Math.ceil(totalProducts / limit);
        const pagination = {
            currentPage: currentPage,
            totalPages: totalPages || 0,
            totalProducts: totalProducts,
            limit: limit,
            hasNextPage: currentPage < totalPages,
            hasPrevPage: currentPage > 1
        };
        
        res.json({
            success: true,
            count: productsWithPrices.length,
            products: productsWithPrices,
            pagination: pagination
        });
    } catch (error) {
        console.error('[Product Controller] Error searching products:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to search products'
        });
    }
};

/**
 * Get product brands (API endpoint)
 * GET /api/products/brands
 */
exports.getBrands = async (req, res) => {
    try {
        const brands = await productService.getBrands();
        
        res.json({
            success: true,
            count: brands.length,
            brands: brands
        });
    } catch (error) {
        console.error('[Product Controller] Error fetching brands:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch brands'
        });
    }
};

/**
 * Upload product images handler
 * POST /api/products/upload-images
 * Note: Multer middleware is applied in app.js before this handler
 */
exports.uploadImages = async (req, res) => {
    try {
        if (!req.files || req.files.length === 0) {
            return res.status(400).json({
                success: false,
                message: 'No images were uploaded'
            });
        }
        
        // Generate URLs for uploaded files
        const imageUrls = req.files.map(file => {
            // Return relative path from public directory
            const imageUrl = `/uploads/products/${file.filename}`;
            console.log('[Image Upload] File saved:', file.path);
            console.log('[Image Upload] Image URL:', imageUrl);
            return imageUrl;
        });
        
        res.json({
            success: true,
            message: `${req.files.length} image(s) uploaded successfully`,
            images: imageUrls
        });
    } catch (error) {
        console.error('[Product Controller] Error in uploadImages:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to upload images'
        });
    }
};

/**
 * Submit review for a product
 * POST /api/products/:id/reviews
 */
exports.submitReview = async (req, res) => {
    try {
        const productId = req.params.id;
        const reviewService = require('../services/review.service');
        const { sanitizeObject } = require('../utils/validators');

        if (!isValidId(productId)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid product ID'
            });
        }

        // Get client IP address
        const ipAddress = req.ip || 
                         req.headers['x-forwarded-for']?.split(',')[0]?.trim() || 
                         req.connection?.remoteAddress || 
                         'unknown';

        // Sanitize input
        const sanitizedData = sanitizeObject(req.body);

        // If logged in, override email and name with verified session data
        const sessionUser = req.customerUser || null;
        if (sessionUser) {
            sanitizedData.email = sessionUser.email;
            sanitizedData.name = sanitizedData.name || sessionUser.name;
        }

        // Validate review data
        const validation = reviewService.validateReviewData(sanitizedData);
        if (!validation.valid) {
            return res.status(400).json({
                success: false,
                message: 'Please check your review details',
                errors: validation.errors
            });
        }

        // Sanitize review data
        const reviewData = reviewService.sanitizeReviewData(sanitizedData);

        const numericId = Number(productId);
        const purchaseVerification = await reviewService.verifyPurchase(numericId, reviewData.email);
        if (!purchaseVerification) {
            return res.status(403).json({
                success: false,
                message: 'Please purchase this product before reviewing'
            });
        }

        // Check for duplicate review
        const duplicateCheck = await reviewService.checkDuplicateReview(
            numericId,
            reviewData.email,
            ipAddress,
            sessionUser?.id || null
        );
        if (duplicateCheck.exists) {
            return res.status(409).json({
                success: false,
                message: 'You already reviewed this product'
            });
        }

        // Prepare review data with verification info
        const finalReviewData = {
            ...reviewData,
            verified: purchaseVerification.verified,
            orderNumber: purchaseVerification.orderNumber,
            ipAddress: ipAddress,
            userId: sessionUser?.id || null
        };

        const product = await productService.addReview(numericId, finalReviewData);

        // Get the newly added review (last one in array)
        const newReview = product.reviews[product.reviews.length - 1];

        // Prepare clean response (exclude sensitive data)
        const reviewResponse = {
            id: newReview.id,
            name: newReview.name,
            title: newReview.title,
            comment: newReview.comment,
            rating: newReview.rating,
            verified: newReview.verified,
            createdAt: newReview.createdAt
        };

        res.status(201).json({
            success: true,
            message: 'Review submitted successfully',
            review: reviewResponse,
            productRating: product.rating,
            totalReviews: product.reviews.length
        });
    } catch (error) {
        console.error('[Product Controller] Error submitting review:', error);
        res.status(500).json({
            success: false,
            message: 'Something went wrong. Please try again.'
        });
    }
};

/**
 * Bulk delete products
 * DELETE /api/products/bulk
 */
exports.bulkDeleteProducts = async (req, res) => {
    try {
        const { productIds } = req.body;
        
        // Validate input
        if (!Array.isArray(productIds) || productIds.length === 0) {
            return res.status(400).json({
                success: false,
                message: 'Product IDs array is required'
            });
        }

        const invalidIds = productIds.filter(id => !isValidId(id));
        if (invalidIds.length > 0) {
            return res.status(400).json({
                success: false,
                message: `Invalid product ID: ${invalidIds.join(', ')}`
            });
        }

        const validIds = productIds.map(id => Number(id));
        const result = await productService.bulkDeleteProducts(validIds);
        
        // Clean up featured products that reference deleted products
        try {
            const featuredProductService = require('../services/featuredProduct.service');
            const removedCount = await featuredProductService.cleanupDeletedProducts();
            if (removedCount > 0) {
                console.log(`[Product Controller] Cleaned up ${removedCount} featured product(s) after bulk deletion`);
            }
        } catch (error) {
            // Log error but don't fail the deletion
            console.error('[Product Controller] Error cleaning up featured products after bulk deletion:', error);
        }

        res.json({
            success: true,
            message: `Successfully deleted ${result.deletedCount} product(s)`,
            data: {
                deletedCount: result.deletedCount,
                requestedCount: productIds.length
            }
        });
    } catch (error) {
        console.error('[Product Controller] Error in bulkDeleteProducts:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to delete products'
        });
    }
};

/**
 * Export products to CSV or JSON
 * GET /api/products/export
 * 
 * Query params:
 * - format: 'csv' | 'json' (default: 'csv')
 * - search: Search term
 * - category: Filter by category
 * - stockStatus: Filter by stock status
 * - minPrice: Minimum price
 * - maxPrice: Maximum price
 */
exports.exportProducts = async (req, res) => {
    try {
        const format = (req.query.format || 'csv').toLowerCase();
        const {
            search,
            category,
            stockStatus,
            minPrice,
            maxPrice
        } = req.query;

        // Validate format
        if (format !== 'csv' && format !== 'json') {
            return res.status(400).json({
                success: false,
                message: 'Invalid format. Must be: csv or json.'
            });
        }

        // Build filters object (Sequelize-compatible via service._buildWhere)
        const filters = {};
        if (category) filters.gender = category;
        if (stockStatus) {
            if (stockStatus === 'in-stock')      filters.inStockOnly = true;
            else if (stockStatus === 'low-stock') filters.lowStockOnly = true;
            else if (stockStatus === 'out-of-stock') filters.outOfStockOnly = true;
        }
        if (minPrice) filters.minPrice = minPrice;
        if (maxPrice) filters.maxPrice = maxPrice;

        // Get all products for export (no pagination limit, max 10,000)
        let products = await productService.getAllProductsForExport(filters);
        
        // Apply search filter if provided
        if (search && search.trim()) {
            const searchTerm = search.trim().toLowerCase();
            products = products.filter(product => {
                const model = (product.model || '').toLowerCase();
                const sku = (product.sku || '').toLowerCase();
                const brand = (product.brand || '').toLowerCase();
                return model.includes(searchTerm) || sku.includes(searchTerm) || brand.includes(searchTerm);
            });
        }

        // Limit to 10,000 products for export
        if (products.length > 10000) {
            products = products.slice(0, 10000);
        }

        if (products.length === 0) {
            return res.status(400).json({
                success: false,
                message: 'No products to export'
            });
        }

        const exportDate = new Date().toISOString().split('T')[0];

        if (format === 'json') {
            // Export as JSON
            const exportData = {
                exportDate: exportDate,
                exportTime: new Date().toISOString(),
                statistics: {
                    totalProducts: products.length,
                    exportedCount: products.length
                },
                filters: {
                    search: search || null,
                    category: category || null,
                    stockStatus: stockStatus || null,
                    minPrice: minPrice || null,
                    maxPrice: maxPrice || null
                },
                products: products.map(product => {
                    const plain = toPlain(product);
                    return {
                        _id: plain.id ?? plain._id,
                        model: plain.model,
                        sku: plain.sku,
                        brand: plain.brand,
                        category: plain.gender || plain.category,
                        description: plain.description,
                        price: plain.price,
                        originalPrice: plain.originalPrice,
                        discount: plain.discount,
                        stock: plain.stock,
                        lowStockThreshold: plain.lowStockThreshold || 5,
                        status: plain.status,
                        images: plain.images || [],
                        videoUrl: plain.videoUrl,
                        warranty: plain.warranty,
                        waterResistance: plain.waterResistance,
                        strapType: plain.strapType,
                        slug: plain.slug,
                        metaTitle: plain.metaTitle,
                        metaDescription: plain.metaDescription,
                        createdAt: plain.createdAt,
                        updatedAt: plain.updatedAt
                    };
                })
            };

            res.setHeader('Content-Type', 'application/json');
            res.setHeader('Content-Disposition', `attachment; filename="products_export_${exportDate}.json"`);
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
                'Model',
                'SKU',
                'Brand',
                'Category',
                'Price',
                'Original Price',
                'Discount (%)',
                'Stock',
                'Low Stock Threshold',
                'Status',
                'Image URL',
                'Video URL',
                'Warranty',
                'Water Resistance',
                'Strap Type',
                'Slug',
                'Created At',
                'Updated At'
            ];

            // Convert products to CSV rows
            const productRows = products.map(product => [
                product.model || '',
                product.sku || '',
                product.brand || '',
                product.gender || product.category || '',
                product.price || 0,
                product.originalPrice || '',
                product.discount || 0,
                product.stock || 0,
                product.lowStockThreshold || 5,
                product.status || 'active',
                (product.images && product.images[0]) || '',
                product.videoUrl || '',
                product.warranty || '',
                product.waterResistance || '',
                product.strapType || '',
                product.slug || '',
                product.createdAt ? new Date(product.createdAt).toISOString() : '',
                product.updatedAt ? new Date(product.updatedAt).toISOString() : ''
            ]);

            // Combine all rows
            const csvContent = [
                headers.map(escapeCsvCell).join(','),
                ...productRows.map(row => row.map(escapeCsvCell).join(','))
            ].join('\n');

            res.setHeader('Content-Type', 'text/csv');
            res.setHeader('Content-Disposition', `attachment; filename="products_export_${exportDate}.csv"`);
            res.send(csvContent);
        }
    } catch (error) {
        console.error('[Product Controller] Error exporting products:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to export products'
        });
    }
};

/**
 * Reorder product images
 * PUT /api/products/:id/images/reorder
 */
exports.reorderProductImages = async (req, res) => {
    try {
        const productId = req.params.id;
        const { imageOrder } = req.body;
        
        if (!isValidId(productId)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid product ID'
            });
        }
        
        if (!Array.isArray(imageOrder) || imageOrder.length === 0) {
            return res.status(400).json({
                success: false,
                message: 'Image order array is required'
            });
        }
        
        const product = await productService.reorderProductImages(Number(productId), imageOrder);
        
        if (!product) {
            return res.status(404).json({
                success: false,
                message: 'Product not found'
            });
        }
        
        res.json({
            success: true,
            message: 'Images reordered successfully',
            product: product
        });
    } catch (error) {
        console.error('[Product Controller] Error reordering images:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to reorder images'
        });
    }
};

/**
 * Set primary/featured image
 * PUT /api/products/:id/images/primary
 */
exports.setPrimaryImage = async (req, res) => {
    try {
        const productId = req.params.id;
        const { imageUrl } = req.body;
        
        if (!isValidId(productId)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid product ID'
            });
        }
        
        if (!imageUrl || typeof imageUrl !== 'string') {
            return res.status(400).json({
                success: false,
                message: 'Image URL is required'
            });
        }
        
        const product = await productService.setPrimaryImage(Number(productId), imageUrl);
        
        if (!product) {
            return res.status(404).json({
                success: false,
                message: 'Product not found'
            });
        }
        
        res.json({
            success: true,
            message: 'Primary image set successfully',
            product: product
        });
    } catch (error) {
        console.error('[Product Controller] Error setting primary image:', error);
        res.status(500).json({
            success: false,
            message: error.message || 'Failed to set primary image'
        });
    }
};

/**
 * Delete a single product image
 * DELETE /api/products/:id/images/:imageId
 */
exports.deleteProductImage = async (req, res) => {
    try {
        const productId = req.params.id;
        const imageUrl = decodeURIComponent(req.params.imageId);
        
        if (!isValidId(productId)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid product ID'
            });
        }
        
        if (!imageUrl || imageUrl.trim().length === 0) {
            return res.status(400).json({
                success: false,
                message: 'Image URL is required'
            });
        }
        
        const product = await productService.deleteProductImage(Number(productId), imageUrl);
        
        if (!product) {
            return res.status(404).json({
                success: false,
                message: 'Product not found'
            });
        }
        
        res.json({
            success: true,
            message: 'Image deleted successfully',
            product: product
        });
    } catch (error) {
        console.error('[Product Controller] Error deleting image:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to delete image'
        });
    }
};

module.exports = exports;
