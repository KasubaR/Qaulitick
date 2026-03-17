require('dotenv').config();
const databaseService = require('../services/database.service');
const productService = require('../services/product.service');

/**
 * Seed data for Qualitick Collections
 * 
 * This script populates the database with sample luxury watch products
 */

const sampleProducts = [
    {
        model: 'Submariner Date',
        brand: 'Rolex',
        price: 3500,
        originalPrice: 4500,
        discount: 22,
        stock: 15,
        rating: 4.9,
        sku: 'ROLEX-SUB-001',
        images: [
            'https://images.unsplash.com/photo-1524805444758-089113d48a6d',
            'https://images.unsplash.com/photo-1523170335258-f5ed11844a49',
            'https://images.unsplash.com/photo-1548169874-53e85f753f1e'
        ],
        description: 'The Rolex Submariner is an iconic diving watch that has become a symbol of luxury and precision. Featuring a robust 904L stainless steel case, scratch-resistant sapphire crystal, and a precision automatic movement that ensures accurate timekeeping. Water-resistant to 300 meters, making it perfect for professional divers and watch enthusiasts alike.',
        colors: [
            { name: 'Black', hexCode: '#000000' },
            { name: 'Blue', hexCode: '#0000FF' }
        ],
        strapOptions: ['Metal Bracelet', 'Rubber Strap'],
        movement: 'Automatic',
        caseMaterial: '904L Stainless Steel',
        strapType: 'Stainless Steel',
        waterResistance: '300m',
        caseDiameter: '40mm',
        glassType: 'Sapphire',
        gender: 'Men',
        warranty: '2 Years International',
        status: 'active'
    },
    {
        model: 'Speedmaster Professional Moonwatch',
        brand: 'Omega',
        price: 3200,
        originalPrice: 3800,
        discount: 16,
        stock: 8,
        rating: 4.8,
        sku: 'OMEGA-SPEED-001',
        images: [
            'https://images.unsplash.com/photo-1604242692760-2f7b0c26856d',
            'https://images.unsplash.com/photo-1587836374234-4e9b4e5e4b5e',
            'https://images.unsplash.com/photo-1614164185128-e4ec99c436d7'
        ],
        description: 'The Omega Speedmaster Professional, also known as the Moonwatch, is the first watch worn on the moon. This legendary chronograph features a manual-wind movement, hesalite crystal, and a tachymeter bezel. Perfect for space enthusiasts and collectors who appreciate horological history.',
        colors: [
            { name: 'Silver', hexCode: '#C0C0C0' },
            { name: 'Black', hexCode: '#000000' }
        ],
        strapOptions: ['Leather Strap', 'Metal Bracelet', 'NATO Strap'],
        movement: 'Manual',
        caseMaterial: 'Stainless Steel',
        strapType: 'Leather',
        waterResistance: '50m',
        caseDiameter: '42mm',
        glassType: 'Sapphire',
        gender: 'Men',
        warranty: '2 Years International',
        status: 'active'
    },
    {
        model: 'Carrera Calibre 16',
        brand: 'Tag Heuer',
        price: 2800,
        stock: 3,
        rating: 4.7,
        sku: 'TAG-CAR-001',
        images: [
            'https://images.unsplash.com/photo-1518544889280-0d9b1eecad61',
            'https://images.unsplash.com/photo-1622434641406-a158123450f9',
            'https://images.unsplash.com/photo-1617625802912-cdf7abc1a7b4'
        ],
        description: 'The Tag Heuer Carrera pays tribute to the legendary Carrera Panamericana race. This racing chronograph combines sporty elegance with precision timing. Features a day-date display, tachymeter scale, and premium finishing throughout.',
        colors: [
            { name: 'Blue', hexCode: '#4169E1' },
            { name: 'Black', hexCode: '#000000' }
        ],
        strapOptions: ['Leather Strap', 'Metal Bracelet'],
        movement: 'Automatic',
        caseMaterial: 'Stainless Steel',
        strapType: 'Leather',
        waterResistance: '100m',
        caseDiameter: '41mm',
        glassType: 'Sapphire',
        gender: 'Unisex',
        warranty: '2 Years International',
        status: 'active'
    },
    {
        model: 'Santos de Cartier',
        brand: 'Cartier',
        price: 4000,
        originalPrice: 4800,
        discount: 17,
        stock: 12,
        rating: 5.0,
        sku: 'CART-SANT-001',
        images: [
            'https://images.unsplash.com/photo-1511379938547-c1f69419868d',
            'https://images.unsplash.com/photo-1587836374194-4e9b4e5e4b5e',
            'https://images.unsplash.com/photo-1563225409-127c18758bd5'
        ],
        description: 'The Cartier Santos is the world\'s first pilot\'s watch, created in 1904. This iconic square watch features Roman numerals, blue hands, and the signature Cartier aesthetic. A perfect blend of elegance and innovation.',
        colors: [
            { name: 'Gold', hexCode: '#FFD700' },
            { name: 'Silver', hexCode: '#C0C0C0' }
        ],
        strapOptions: ['Metal Bracelet', 'Leather Strap'],
        movement: 'Automatic',
        caseMaterial: 'Stainless Steel',
        strapType: 'Stainless Steel',
        waterResistance: '100m',
        caseDiameter: '39.8mm',
        glassType: 'Sapphire',
        gender: 'Women',
        warranty: '2 Years International',
        status: 'active'
    },
    {
        model: 'Royal Oak',
        brand: 'Audemars Piguet',
        price: 5500,
        stock: 6,
        rating: 4.9,
        sku: 'AP-RO-001',
        images: [
            'https://images.unsplash.com/photo-1547996160-81cdd998f5c5',
            'https://images.unsplash.com/photo-1594534475808-b18fc33b045e',
            'https://images.unsplash.com/photo-1509941943102-10c232535736'
        ],
        description: 'The Audemars Piguet Royal Oak revolutionized luxury watchmaking in 1972. Its iconic octagonal bezel, "Tapisserie" dial pattern, and integrated bracelet make it instantly recognizable. A masterpiece of Gerald Genta\'s design.',
        colors: [
            { name: 'Silver', hexCode: '#C0C0C0' },
            { name: 'Blue', hexCode: '#000080' }
        ],
        strapOptions: ['Metal Bracelet'],
        movement: 'Automatic',
        caseMaterial: 'Stainless Steel',
        strapType: 'Stainless Steel',
        waterResistance: '50m',
        caseDiameter: '41mm',
        glassType: 'Sapphire',
        gender: 'Men',
        warranty: '2 Years International',
        status: 'active'
    },
    {
        model: 'Nautilus',
        brand: 'Patek Philippe',
        price: 6200,
        originalPrice: 7500,
        discount: 17,
        stock: 4,
        rating: 5.0,
        sku: 'PATEK-NAUT-001',
        images: [
            'https://images.unsplash.com/photo-1523275335684-37898b6baf30',
            'https://images.unsplash.com/photo-1587836374228-4e9b4e5e4b5e',
            'https://images.unsplash.com/photo-1611779309849-6a5f0e6c0fae'
        ],
        description: 'The Patek Philippe Nautilus is the pinnacle of luxury sports watches. Designed by Gerald Genta in 1976, its porthole-inspired case and horizontal embossed dial make it one of the most sought-after watches in the world.',
        colors: [
            { name: 'Blue', hexCode: '#000080' },
            { name: 'Silver', hexCode: '#C0C0C0' }
        ],
        strapOptions: ['Metal Bracelet', 'Leather Strap'],
        movement: 'Automatic',
        caseMaterial: 'Stainless Steel',
        strapType: 'Stainless Steel',
        waterResistance: '120m',
        caseDiameter: '40mm',
        glassType: 'Sapphire',
        gender: 'Men',
        warranty: '2 Years International',
        status: 'active'
    },
    {
        model: 'Datejust 36',
        brand: 'Rolex',
        price: 3800,
        originalPrice: 4200,
        discount: 10,
        stock: 20,
        rating: 4.8,
        sku: 'ROLEX-DJ-001',
        images: [
            'https://images.unsplash.com/photo-1533139262209-b6647e773d1e',
            'https://images.unsplash.com/photo-1522312346375-d1a52e2b99b3',
            'https://images.unsplash.com/photo-1548169874-53e85f753f1e'
        ],
        description: 'The Rolex Datejust is the epitome of classic elegance. Introduced in 1945, it was the first self-winding chronometer with a date display. Features the iconic Cyclops lens and Jubilee bracelet.',
        colors: [
            { name: 'Gold', hexCode: '#FFD700' },
            { name: 'Silver', hexCode: '#C0C0C0' },
            { name: 'Two-Tone', hexCode: '#D4AF37' }
        ],
        strapOptions: ['Jubilee Bracelet', 'Oyster Bracelet', 'Leather Strap'],
        movement: 'Automatic',
        caseMaterial: '904L Stainless Steel',
        strapType: 'Jubilee Bracelet',
        waterResistance: '100m',
        caseDiameter: '36mm',
        glassType: 'Sapphire',
        gender: 'Unisex',
        warranty: '2 Years International',
        status: 'active'
    },
    {
        model: 'Seamaster Diver 300M',
        brand: 'Omega',
        price: 3400,
        stock: 10,
        rating: 4.7,
        sku: 'OMEGA-SEAMASTER-001',
        images: [
            'https://images.unsplash.com/photo-1614164185128-e4ec99c436d7',
            'https://images.unsplash.com/photo-1587836374234-4e9b4e5e4b5e',
            'https://images.unsplash.com/photo-1622434641406-a158123450f9'
        ],
        description: 'The Omega Seamaster is James Bond\'s watch of choice. This professional diving watch features a helium escape valve, unidirectional rotating bezel, and exceptional water resistance. Perfect for diving and everyday luxury.',
        colors: [
            { name: 'Black', hexCode: '#000000' },
            { name: 'Blue', hexCode: '#0000FF' }
        ],
        strapOptions: ['Metal Bracelet', 'Rubber Strap', 'NATO Strap'],
        movement: 'Automatic',
        caseMaterial: 'Stainless Steel',
        strapType: 'Stainless Steel',
        waterResistance: '300m',
        caseDiameter: '42mm',
        glassType: 'Sapphire',
        gender: 'Men',
        warranty: '2 Years International',
        status: 'active'
    }
];

/**
 * Seed the database
 */
async function seedDatabase() {
    try {
        console.log('🌱 Starting database seed...');
        
        // Connect to database
        await databaseService.connect();
        
        // Clear existing products (optional - comment out if you want to keep existing data)
        console.log('🗑️  Clearing existing products...');
        const Product = require('../models/Product.model');
        await Product.deleteMany({});
        console.log('✅ Existing products cleared');
        
        // Insert sample products
        console.log('📦 Inserting sample products...');
        for (const productData of sampleProducts) {
            try {
                const product = await productService.createProduct(productData);
                console.log(`✅ Created: ${product.brand} ${product.model} (${product.sku})`);
            } catch (error) {
                console.error(`❌ Failed to create ${productData.brand} ${productData.model}:`, error.message);
            }
        }
        
        // Get statistics
        const stats = await databaseService.getStats();
        console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log('📊 Database Statistics:');
        console.log(`   Collections: ${stats.collections}`);
        console.log(`   Data Size: ${stats.dataSize}`);
        console.log(`   Storage Size: ${stats.storageSize}`);
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        
        console.log('\n✅ Database seeded successfully!');
        console.log(`📦 Total products created: ${sampleProducts.length}`);
        
        // Disconnect
        await databaseService.disconnect();
        process.exit(0);
        
    } catch (error) {
        console.error('❌ Error seeding database:', error);
        await databaseService.disconnect();
        process.exit(1);
    }
}

// Run the seed function
seedDatabase();
