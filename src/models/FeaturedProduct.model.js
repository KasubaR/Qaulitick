const { sequelize } = require('../config/mysql');
const { DataTypes } = require('sequelize');

const FeaturedProduct = sequelize.define('FeaturedProduct', {
    id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
    },
    productId: { type: DataTypes.INTEGER, allowNull: false },
    order: { type: DataTypes.INTEGER, allowNull: false },
    isActive: { type: DataTypes.BOOLEAN, defaultValue: true }
}, {
    tableName: 'featured_products',
    timestamps: true
});

FeaturedProduct.findActive = function() {
    return this.findAll({ where: { isActive: true }, order: [['order', 'ASC']] });
};

FeaturedProduct.getMaxOrder = async function() {
    const one = await this.findOne({ where: { isActive: true }, order: [['order', 'DESC']], attributes: ['order'] });
    return one ? one.order : 0;
};

FeaturedProduct.findByProductId = function(productId) {
    return this.findOne({ where: { productId } });
};

FeaturedProduct.reorderAll = async function() {
    const list = await this.findAll({ where: { isActive: true }, order: [['order', 'ASC']] });
    await sequelize.transaction(async (t) => {
        await Promise.all(list.map((item, i) =>
            item.update({ order: i + 1 }, { transaction: t })
        ));
    });
    return list;
};

module.exports = FeaturedProduct;
