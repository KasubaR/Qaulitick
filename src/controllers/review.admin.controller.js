// Admin Review Controller
const Product = require('../models/Product.model');
const Settings = require('../models/Settings.model');

const MAX_HOMEPAGE_TESTIMONIALS = 6;

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Recalculate and return the average rating for an array of reviews.
 */
function calcRating(reviews) {
    if (!reviews.length) return 0;
    const total = reviews.reduce((sum, r) => sum + (Number(r.rating) || 0), 0);
    return parseFloat((total / reviews.length).toFixed(1));
}

/**
 * Strip sensitive fields before sending review data to the client.
 */
function sanitizeReview(review) {
    const { email, ipAddress, ...safe } = review;
    return safe;
}

// ─── Controllers ──────────────────────────────────────────────────────────────

/**
 * GET /api/admin/reviews
 * Returns a paginated, filterable list of all reviews across every product.
 *
 * Query params:
 *   page        {number}  default 1
 *   limit       {number}  default 20, max 100
 *   rating      {number}  filter by exact star rating (1-5)
 *   verified    {boolean} filter verified-purchase reviews only
 *   featured    {boolean} filter reviews featured on the homepage
 *   search      {string}  case-insensitive match against reviewer name or product name
 */
exports.getAllReviews = async (req, res) => {
    try {
        const page     = Math.max(1, parseInt(req.query.page)  || 1);
        const limit    = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));
        const offset   = (page - 1) * limit;

        const ratingFilter   = req.query.rating   ? parseInt(req.query.rating)            : null;
        const verifiedFilter = req.query.verified !== undefined ? req.query.verified === 'true' : null;
        const featuredFilter = req.query.featured !== undefined ? req.query.featured === 'true' : null;
        const search         = req.query.search   ? req.query.search.trim().toLowerCase()  : null;

        // Load featured testimonials once so we can tag each review
        const settings = await Settings.getSettings();
        const featured = Array.isArray(settings.homepageTestimonials)
            ? settings.homepageTestimonials
            : [];
        const featuredSet = new Set(featured.map(t => `${t.productId}:${t.reviewId}`));

        // Pull all products that have at least one review
        const products = await Product.findAll({
            attributes: ['id', 'model', 'brand', 'images', 'reviews']
        });

        // Flatten into a single list with product context attached
        let allReviews = [];
        for (const product of products) {
            const reviews = product.reviews || [];
            if (!reviews.length) continue;

            const productObj = {
                id:   product.id,
                name: `${product.brand} ${product.model}`.trim(),
                image: Array.isArray(product.images) && product.images.length ? product.images[0] : null
            };

            for (const review of reviews) {
                allReviews.push({
                    ...sanitizeReview(review),
                    productId:   productObj.id,
                    productName: productObj.name,
                    productImage: productObj.image,
                    featured:    featuredSet.has(`${productObj.id}:${review.id}`)
                });
            }
        }

        // Apply filters
        if (ratingFilter !== null) {
            allReviews = allReviews.filter(r => r.rating === ratingFilter);
        }
        if (verifiedFilter !== null) {
            allReviews = allReviews.filter(r => !!r.verified === verifiedFilter);
        }
        if (featuredFilter !== null) {
            allReviews = allReviews.filter(r => r.featured === featuredFilter);
        }
        if (search) {
            allReviews = allReviews.filter(r =>
                (r.name        || '').toLowerCase().includes(search) ||
                (r.productName || '').toLowerCase().includes(search)
            );
        }

        // Sort newest first
        allReviews.sort((a, b) => {
            const da = new Date(a.createdAt || 0);
            const db = new Date(b.createdAt || 0);
            return db - da;
        });

        const total      = allReviews.length;
        const totalPages = Math.ceil(total / limit) || 1;
        const paginated  = allReviews.slice(offset, offset + limit);

        // Summary stats (across the unfiltered full set for the stats bar)
        const allForStats = allReviews; // already filtered — intentional; stats reflect current filter
        const avgRating = allForStats.length
            ? parseFloat((allForStats.reduce((s, r) => s + (r.rating || 0), 0) / allForStats.length).toFixed(1))
            : 0;

        res.json({
            success: true,
            reviews:       paginated,
            pagination: {
                page,
                limit,
                total,
                totalPages
            },
            stats: {
                total,
                averageRating: avgRating,
                verifiedCount:  allForStats.filter(r => r.verified).length,
                featuredCount:  featured.length
            }
        });
    } catch (error) {
        console.error('[Review Admin] Error fetching reviews:', error);
        res.status(500).json({ success: false, message: 'Failed to fetch reviews' });
    }
};

/**
 * DELETE /api/admin/reviews/:productId/:reviewId
 * Removes a review from the product and recalculates its aggregate rating.
 * Also removes the review from homepageTestimonials if it was featured.
 */
exports.deleteReview = async (req, res) => {
    try {
        const productId = parseInt(req.params.productId, 10);
        const reviewId  = parseInt(req.params.reviewId, 10);

        if (isNaN(productId) || isNaN(reviewId)) {
            return res.status(400).json({ success: false, message: 'Invalid productId or reviewId' });
        }

        const product = await Product.findByPk(productId);
        if (!product) {
            return res.status(404).json({ success: false, message: 'Product not found' });
        }

        const reviews    = product.reviews || [];
        const reviewIdx  = reviews.findIndex(r => r.id === reviewId);
        if (reviewIdx === -1) {
            return res.status(404).json({ success: false, message: 'Review not found' });
        }

        const updatedReviews = reviews.filter(r => r.id !== reviewId);
        product.reviews = updatedReviews;
        product.rating  = calcRating(updatedReviews);
        await product.save();

        // Remove from featured testimonials if present
        const settings  = await Settings.getSettings();
        const testimonials = Array.isArray(settings.homepageTestimonials)
            ? settings.homepageTestimonials
            : [];
        const updatedTestimonials = testimonials.filter(
            t => !(String(t.productId) === String(productId) && String(t.reviewId) === String(reviewId))
        );
        if (updatedTestimonials.length !== testimonials.length) {
            settings.homepageTestimonials = updatedTestimonials;
            await settings.save();
        }

        res.json({
            success:      true,
            message:      'Review deleted successfully',
            newRating:    product.rating,
            totalReviews: updatedReviews.length
        });
    } catch (error) {
        console.error('[Review Admin] Error deleting review:', error);
        res.status(500).json({ success: false, message: 'Failed to delete review' });
    }
};

/**
 * POST /api/admin/reviews/:productId/:reviewId/feature
 * Adds the review to homepageTestimonials (max 6).
 */
exports.featureReview = async (req, res) => {
    try {
        const productId = parseInt(req.params.productId, 10);
        const reviewId  = parseInt(req.params.reviewId, 10);

        if (isNaN(productId) || isNaN(reviewId)) {
            return res.status(400).json({ success: false, message: 'Invalid productId or reviewId' });
        }

        // Confirm the product and review both exist
        const product = await Product.findByPk(productId, { attributes: ['id', 'reviews'] });
        if (!product) {
            return res.status(404).json({ success: false, message: 'Product not found' });
        }
        const review = (product.reviews || []).find(r => r.id === reviewId);
        if (!review) {
            return res.status(404).json({ success: false, message: 'Review not found' });
        }

        const settings     = await Settings.getSettings();
        const testimonials = Array.isArray(settings.homepageTestimonials)
            ? settings.homepageTestimonials
            : [];

        // Already featured — idempotent
        const alreadyFeatured = testimonials.some(
            t => String(t.productId) === String(productId) && String(t.reviewId) === String(reviewId)
        );
        if (alreadyFeatured) {
            return res.json({ success: true, message: 'Review is already featured', count: testimonials.length });
        }

        if (testimonials.length >= MAX_HOMEPAGE_TESTIMONIALS) {
            return res.status(400).json({
                success: false,
                message: `Maximum of ${MAX_HOMEPAGE_TESTIMONIALS} homepage testimonials allowed. Remove one first.`
            });
        }

        settings.homepageTestimonials = [...testimonials, { productId, reviewId }];
        await settings.save();

        res.json({
            success: true,
            message: 'Review featured on homepage',
            count:   settings.homepageTestimonials.length
        });
    } catch (error) {
        console.error('[Review Admin] Error featuring review:', error);
        res.status(500).json({ success: false, message: 'Failed to feature review' });
    }
};

/**
 * DELETE /api/admin/reviews/:productId/:reviewId/feature
 * Removes the review from homepageTestimonials.
 */
exports.unfeatureReview = async (req, res) => {
    try {
        const productId = parseInt(req.params.productId, 10);
        const reviewId  = parseInt(req.params.reviewId, 10);

        if (isNaN(productId) || isNaN(reviewId)) {
            return res.status(400).json({ success: false, message: 'Invalid productId or reviewId' });
        }

        const settings     = await Settings.getSettings();
        const testimonials = Array.isArray(settings.homepageTestimonials)
            ? settings.homepageTestimonials
            : [];

        const updated = testimonials.filter(
            t => !(String(t.productId) === String(productId) && String(t.reviewId) === String(reviewId))
        );

        if (updated.length === testimonials.length) {
            return res.status(404).json({ success: false, message: 'Review is not currently featured' });
        }

        settings.homepageTestimonials = updated;
        await settings.save();

        res.json({
            success: true,
            message: 'Review removed from homepage',
            count:   updated.length
        });
    } catch (error) {
        console.error('[Review Admin] Error unfeaturing review:', error);
        res.status(500).json({ success: false, message: 'Failed to unfeature review' });
    }
};

/**
 * GET /api/admin/reviews/homepage-testimonials
 * Returns the current homepage testimonials list resolved to full review objects.
 */
exports.getHomepageTestimonials = async (req, res) => {
    try {
        const settings     = await Settings.getSettings();
        const testimonials = Array.isArray(settings.homepageTestimonials)
            ? settings.homepageTestimonials
            : [];

        if (!testimonials.length) {
            return res.json({ success: true, testimonials: [] });
        }

        // Resolve each {productId, reviewId} into a full review object
        const resolved = await Promise.all(
            testimonials.map(async ({ productId, reviewId }) => {
                try {
                    const product = await Product.findByPk(productId, {
                        attributes: ['id', 'model', 'brand', 'images', 'reviews']
                    });
                    if (!product) return null;

                    const review = (product.reviews || []).find(r => r.id === reviewId);
                    if (!review) return null;

                    return {
                        ...sanitizeReview(review),
                        productId:    product.id,
                        productName:  `${product.brand} ${product.model}`.trim(),
                        productImage: Array.isArray(product.images) && product.images.length
                            ? product.images[0]
                            : null
                    };
                } catch (err) {
                    console.warn(`[Review Admin] Could not resolve testimonial productId=${productId} reviewId=${reviewId}:`, err.message);
                    return null;
                }
            })
        );

        res.json({
            success:      true,
            testimonials: resolved.filter(t => t !== null)
        });
    } catch (error) {
        console.error('[Review Admin] Error fetching homepage testimonials:', error);
        res.status(500).json({ success: false, message: 'Failed to fetch homepage testimonials' });
    }
};
