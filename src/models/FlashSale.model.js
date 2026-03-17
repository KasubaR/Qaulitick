const { sequelize } = require('../config/mysql');
const { DataTypes, Op } = require('sequelize');

function getComputedStatus(status, startDate, endDate) {
    const now = new Date();
    if (status === 'cancelled') return 'cancelled';
    if (now < startDate) return 'scheduled';
    if (now > endDate) return 'ended';
    return 'active';
}

const FlashSale = sequelize.define('FlashSale', {
    id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
    },
    name: { type: DataTypes.STRING(200), allowNull: false },
    productIds: { type: DataTypes.JSON, allowNull: true, defaultValue: [] },
    discount: { type: DataTypes.INTEGER, allowNull: false },
    startDate: { type: DataTypes.DATE, allowNull: false },
    endDate: { type: DataTypes.DATE, allowNull: false },
    showBanner: { type: DataTypes.BOOLEAN, defaultValue: true },
    showStockAlert: { type: DataTypes.BOOLEAN, defaultValue: false },
    bannerText: { type: DataTypes.STRING(500), allowNull: true },
    status: {
        type: DataTypes.ENUM('active', 'scheduled', 'ended', 'cancelled'),
        defaultValue: 'active'
    }
}, {
    tableName: 'flash_sales',
    timestamps: true,
    hooks: {
        beforeSave: (sale) => {
            if (sale.status !== 'cancelled') {
                sale.status = getComputedStatus(sale.status, sale.startDate, sale.endDate);
            }
        }
    }
});

FlashSale.prototype.getComputedStatus = function() {
    return getComputedStatus(this.status, this.startDate, this.endDate);
};

Object.defineProperty(FlashSale.prototype, 'isActive', {
    get() {
        const now = new Date();
        return this.status === 'active' && now >= this.startDate && now <= this.endDate;
    }
});

FlashSale.findActive = function() {
    const now = new Date();
    return this.findAll({
        where: {
            status: 'active',
            startDate: { [Op.lte]: now },
            endDate: { [Op.gte]: now }
        }
    });
};

FlashSale.findScheduled = function() {
    const now = new Date();
    return this.findAll({
        where: { status: 'active', startDate: { [Op.gt]: now } }
    });
};

FlashSale.findEnded = function() {
    const now = new Date();
    return this.findAll({ where: { endDate: { [Op.lt]: now } } });
};

module.exports = FlashSale;
