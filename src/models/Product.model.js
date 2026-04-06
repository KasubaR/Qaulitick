const { sequelize } = require('../config/mysql');
const { DataTypes, Op } = require('sequelize');

const Product = sequelize.define('Product', {
    id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
    },
    model: { type: DataTypes.STRING(200), allowNull: false },
    brand: { type: DataTypes.STRING(100), allowNull: false },
    sku: { type: DataTypes.STRING(100), allowNull: false },
    price: { type: DataTypes.DECIMAL(12, 2), allowNull: false },
    originalPrice: { type: DataTypes.DECIMAL(12, 2), allowNull: true },
    discount: { type: DataTypes.INTEGER, defaultValue: 0 },
    stock: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    /** Legacy column; no longer used (stock reservation removed). Kept for existing DB rows. */
    reservedStock: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    lowStockThreshold: { type: DataTypes.INTEGER, defaultValue: 5 },
    description: { type: DataTypes.TEXT, allowNull: true },
    images: {
        type: DataTypes.JSON, allowNull: true, defaultValue: [],
        get() {
            const v = this.getDataValue('images');
            if (typeof v === 'string') { try { return JSON.parse(v); } catch { return []; } }
            return Array.isArray(v) ? v : [];
        }
    },
    colors: {
        type: DataTypes.JSON, allowNull: true, defaultValue: [],
        get() {
            const v = this.getDataValue('colors');
            if (typeof v === 'string') { try { return JSON.parse(v); } catch { return []; } }
            return Array.isArray(v) ? v : [];
        }
    },
    strapOptions: {
        type: DataTypes.JSON, allowNull: true, defaultValue: [],
        get() {
            const v = this.getDataValue('strapOptions');
            if (typeof v === 'string') { try { return JSON.parse(v); } catch { return []; } }
            return Array.isArray(v) ? v : [];
        }
    },
    movement: { type: DataTypes.STRING(50), allowNull: true },
    caseMaterial: { type: DataTypes.STRING(100), allowNull: true },
    strapType: { type: DataTypes.STRING(100), allowNull: true },
    waterResistance: { type: DataTypes.STRING(50), allowNull: true },
    caseDiameter: { type: DataTypes.STRING(50), allowNull: true },
    glassType: { type: DataTypes.STRING(50), allowNull: true },
    gender: { type: DataTypes.ENUM('Men', 'Women', 'Unisex', 'Accessories', 'Gift Picks', ''), defaultValue: '' },
    rating: { type: DataTypes.DECIMAL(3, 2), defaultValue: 0 },
    reviews: {
        type: DataTypes.JSON, allowNull: true, defaultValue: [],
        get() {
            const v = this.getDataValue('reviews');
            if (typeof v === 'string') { try { return JSON.parse(v); } catch { return []; } }
            return Array.isArray(v) ? v : [];
        }
    },
    shippingPrice: { type: DataTypes.DECIMAL(10, 2), allowNull: false, defaultValue: 0 },
    warranty: { type: DataTypes.STRING(200), allowNull: true },
    status: {
        type: DataTypes.ENUM('active', 'inactive', 'discontinued', 'out_of_stock'),
        defaultValue: 'active'
    },
    sortOrder: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0
    }
}, {
    tableName: 'products',
    timestamps: true,
    indexes: [
        // Declared here instead of unique:true on the column so that
        // sequelize.sync({ alter:true }) deduplicates the index correctly
        // and does not issue a new ALTER TABLE on every boot.
        { unique: true, fields: ['sku'], name: 'products_sku_unique' }
    ],
    hooks: {
        beforeSave: (product) => {
            if (product.originalPrice && product.originalPrice > product.price) {
                product.discount = Math.max(0, Math.round(((product.originalPrice - product.price) / product.originalPrice) * 100));
            } else {
                product.discount = 0;
            }
            const available = Math.max(0, Number(product.stock) || 0);
            if (available === 0 && product.status !== 'discontinued') product.status = 'out_of_stock';
            else if (available > 0 && product.status === 'out_of_stock') product.status = 'active';
            // Legacy column — keep at 0 so the chk_reserved DB constraint (reservedStock <= stock) never fires
            product.reservedStock = 0;
        }
    }
});

Product.prototype.isLowStock = function(threshold = null) {
    const t = threshold !== null ? threshold : (this.lowStockThreshold || 5);
    const available = Math.max(0, Number(this.stock) || 0);
    return available > 0 && available <= t;
};

Product.prototype.updateStock = async function(quantity) {
    this.stock = Math.max(0, Number(this.stock) + quantity);
    if (this.stock === 0) this.status = 'out_of_stock';
    else if (this.status === 'out_of_stock') this.status = 'active';
    return this.save();
};

Product.findByBrand = function(brand) {
    return this.findAll({ where: { brand, status: 'active' } });
};

Product.findInStock = function() {
    return this.findAll({ where: { stock: { [Op.gt]: 0 }, status: 'active' } });
};

Product.findOnSale = function() {
    return this.findAll({
        where: { discount: { [Op.gt]: 0 }, status: 'active', stock: { [Op.gt]: 0 } },
        order: [['discount', 'DESC']]
    });
};

module.exports = Product;
