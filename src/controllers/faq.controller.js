const Faq = require('../models/Faq.model');
const logger = require('../utils/logger').child({ module: 'FaqController' });

const ORDER = [['sortOrder', 'ASC'], ['id', 'ASC']];

function cleanString(value, max) {
    return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function parseFaqBody(body) {
    const question = cleanString(body.question, 500);
    const answer = cleanString(body.answer, 10000);
    const category = cleanString(body.category, 100) || null;
    const sortOrder = Number.parseInt(body.sortOrder, 10);
    return {
        question,
        answer,
        category,
        sortOrder: Number.isFinite(sortOrder) ? sortOrder : 0,
        isPublished: body.isPublished !== false && body.isPublished !== 'false'
    };
}

// Published FAQs grouped by category (null/empty category => "General"), used by the /faq page.
async function getPublishedFaqGroups() {
    const faqs = await Faq.findAll({ where: { isPublished: true }, order: ORDER });
    const groups = new Map();
    for (const faq of faqs) {
        const key = faq.category || 'General';
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(faq.toJSON());
    }
    return Array.from(groups, ([category, items]) => ({ category, items }));
}

exports.renderFaqPage = async (req, res) => {
    let groups = [];
    try {
        groups = await getPublishedFaqGroups();
    } catch (error) {
        logger.error({ err: error }, 'Failed to load FAQs for /faq');
    }
    res.render('faq', { title: 'FAQ | Qualitick Collections', page: 'faq', faqGroups: groups });
};

exports.getPublishedFaqs = async (req, res) => {
    try {
        const faqs = await Faq.findAll({ where: { isPublished: true }, order: ORDER });
        res.json({ success: true, faqs });
    } catch (error) {
        logger.error({ err: error }, 'Failed to fetch published FAQs');
        res.status(500).json({ success: false, message: 'Failed to fetch FAQs' });
    }
};

exports.getAllFaqs = async (req, res) => {
    try {
        const faqs = await Faq.findAll({ order: ORDER });
        res.json({ success: true, faqs });
    } catch (error) {
        logger.error({ err: error }, 'Failed to fetch FAQs');
        res.status(500).json({ success: false, message: 'Failed to fetch FAQs' });
    }
};

exports.createFaq = async (req, res) => {
    try {
        const data = parseFaqBody(req.body || {});
        if (!data.question || !data.answer) {
            return res.status(400).json({ success: false, message: 'Question and answer are required' });
        }
        const faq = await Faq.create(data);
        res.status(201).json({ success: true, faq });
    } catch (error) {
        logger.error({ err: error }, 'Failed to create FAQ');
        res.status(500).json({ success: false, message: 'Failed to create FAQ' });
    }
};

exports.updateFaq = async (req, res) => {
    try {
        const faq = await Faq.findByPk(Number.parseInt(req.params.id, 10));
        if (!faq) return res.status(404).json({ success: false, message: 'FAQ not found' });

        const data = parseFaqBody(req.body || {});
        if (!data.question || !data.answer) {
            return res.status(400).json({ success: false, message: 'Question and answer are required' });
        }
        await faq.update(data);
        res.json({ success: true, faq });
    } catch (error) {
        logger.error({ err: error }, 'Failed to update FAQ');
        res.status(500).json({ success: false, message: 'Failed to update FAQ' });
    }
};

exports.deleteFaq = async (req, res) => {
    try {
        const deleted = await Faq.destroy({ where: { id: Number.parseInt(req.params.id, 10) } });
        if (!deleted) return res.status(404).json({ success: false, message: 'FAQ not found' });
        res.json({ success: true, message: 'FAQ deleted' });
    } catch (error) {
        logger.error({ err: error }, 'Failed to delete FAQ');
        res.status(500).json({ success: false, message: 'Failed to delete FAQ' });
    }
};
