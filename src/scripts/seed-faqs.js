require('dotenv').config();
const { connectDatabase } = require('../config/database');

/**
 * FAQ Seeding Script
 *
 * Loads the questions that used to be hard-coded on the Contact page into the
 * faqs table. Does nothing if the table already has rows, so it is safe to
 * re-run and will never overwrite edits made in the admin panel.
 *
 * Usage: npm run seed:faqs
 */
const FAQS = [
    {
        question: 'How long does shipping take?',
        answer: 'In-stock items are dispatched within 2 business days of confirmed payment, and pre-order items are delivered within 10–12 business days. Courier transit time after dispatch depends on your location, and estimated delivery times are shown at checkout.',
        category: 'Shipping & Delivery'
    },
    {
        question: 'What is your return policy?',
        answer: 'Returns are accepted only if the watch is defective or damaged on delivery. Please report the issue within 48 hours of delivery. Return shipping costs are the customer’s responsibility unless otherwise agreed, and refunds are processed within 15–20 business days after inspection and approval. See our Terms & Conditions for full details.',
        category: 'Returns & Warranty'
    },
    {
        question: 'Do you ship outside Zambia?',
        answer: 'No. We currently ship within Zambia only. If you need delivery to a remote area, we will confirm feasibility and any extra lead time before dispatch.',
        category: 'Shipping & Delivery'
    },
    {
        question: 'Are your watches authentic?',
        answer: 'We specialise in premium triple-A grade luxury watches. All images we share are actual product images unless otherwise stated, so what you see is exactly what you receive.',
        category: 'Products'
    },
    {
        question: 'When will I receive my order?',
        answer: 'Once your payment is confirmed, in-stock orders are dispatched within 2 business days and pre-orders arrive within 10–12 business days. Layby orders are dispatched after the full balance has been paid. We send updates by email or SMS where applicable, and share tracking details where our courier allows.',
        category: 'Shipping & Delivery'
    },
    {
        question: 'Do you deliver nationwide?',
        answer: 'Yes, we deliver across Zambia to the address you provide at checkout. Delivery fees, if any, are calculated at checkout (for example, pickup options may have no delivery charge), and delivery times depend on your location and courier schedules.',
        category: 'Shipping & Delivery'
    },
    {
        question: 'Are there any hidden charges?',
        answer: 'No. Prices are displayed on each product listing, and any delivery fee is shown at checkout before you pay. Layby has no extra fees: you only pay the agreed product price.',
        category: 'Pricing & Payments'
    },
    {
        question: 'What if there is a problem with my product?',
        answer: 'Contact us via WhatsApp or email with your proof of purchase and clear photos or videos of the issue. If it is a manufacturing defect covered by warranty, we may repair the watch, replace it, or offer a suitable alternative, and we cover the delivery costs. Damage on delivery must be reported within 48 hours.',
        category: 'Returns & Warranty'
    },
    {
        question: 'How long is the warranty?',
        answer: 'Our watches have a limited warranty against manufacturing defects, such as a faulty movement or defective internal components, valid for 3–6 months from the date of delivery. It applies to the original purchaser only and does not cover physical or water damage, battery depletion, normal wear and tear, strap wear, or misuse.',
        category: 'Returns & Warranty'
    },
    {
        question: 'How does layby work?',
        answer: 'Pay a minimum 30% deposit to reserve your watch, then settle the balance in one or more payments within 90 days. Your watch is dispatched once the full balance is cleared. If the balance is not settled within the 90-day period, the order may be cancelled and the deposit forfeited.',
        category: 'Pricing & Payments'
    },
    {
        question: 'What payment methods do you accept?',
        answer: 'We accept Mobile Money (MTN and Airtel), bank transfer (FNB and other major banks), and secure online payment channels shown at checkout.',
        category: 'Pricing & Payments'
    }
];

async function seedFaqs() {
    try {
        await connectDatabase();
        const Faq = require('../models/Faq.model');

        const existing = await Faq.count();
        if (existing > 0) {
            console.log(`⚠️  faqs table already has ${existing} row(s); nothing seeded.`);
        } else {
            await Faq.bulkCreate(FAQS.map((faq, index) => ({ ...faq, sortOrder: index, isPublished: true })));
            console.log(`✅ Seeded ${FAQS.length} FAQs.`);
        }

        const databaseService = require('../services/database.service');
        await databaseService.disconnect();
        process.exit(0);
    } catch (error) {
        console.error('❌ Error seeding FAQs:', error.message);
        process.exit(1);
    }
}

seedFaqs();
