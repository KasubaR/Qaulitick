const { sequelize } = require('../config/mysql');
const { DataTypes, Op } = require('sequelize');

function mapLencoStatusToPaymentStatus(lencoStatus) {
    if (lencoStatus == null || lencoStatus === '') return 'pending';
    const key = String(lencoStatus).toLowerCase().trim();
    const map = {
        pending: 'pending',
        'pay-offline': 'pending',
        processing: 'processing',
        successful: 'completed',
        success: 'completed',
        succeeded: 'completed',
        paid: 'completed',
        completed: 'completed',
        complete: 'completed',
        failed: 'failed',
        cancelled: 'cancelled',
        canceled: 'cancelled',
        expired: 'cancelled'
    };
    return map[key] || 'pending';
}

const Payment = sequelize.define('Payment', {
    id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
    },
    orderNumber: { type: DataTypes.STRING(50), allowNull: false },
    paymentMethod: {
        type: DataTypes.ENUM('mobile_money', 'bank_transfer', 'card', 'cash_on_delivery'),
        allowNull: false
    },
    amount: { type: DataTypes.DECIMAL(12, 2), allowNull: false },
    currency: { type: DataTypes.STRING(10), defaultValue: 'ZMW' },
    status: {
        type: DataTypes.ENUM('pending', 'processing', 'completed', 'failed', 'cancelled', 'refunded'),
        defaultValue: 'pending'
    },
    customerInfo: { type: DataTypes.JSON, allowNull: true },
    lencoTransactionId: { type: DataTypes.STRING(100), allowNull: true },
    lencoReference: { type: DataTypes.STRING(100), allowNull: true },
    lencoProvider: { type: DataTypes.STRING(20), allowNull: true },
    lencoStatus: { type: DataTypes.STRING(50), allowNull: true },
    lencoResponse: { type: DataTypes.JSON, allowNull: true },
    webhookReceived: { type: DataTypes.BOOLEAN, defaultValue: false },
    webhookPayload: { type: DataTypes.JSON, allowNull: true },
    webhookReceivedAt: { type: DataTypes.DATE, allowNull: true },
    gatewayResponse: { type: DataTypes.JSON, allowNull: true },
    transactionId: { type: DataTypes.STRING(100), allowNull: true },
    paymentInstructions: { type: DataTypes.TEXT, allowNull: true },
    qrCode: { type: DataTypes.TEXT, allowNull: true },
    paymentUrl: { type: DataTypes.STRING(500), allowNull: true },
    bankDetails: { type: DataTypes.JSON, allowNull: true },
    expiresAt: { type: DataTypes.DATE, allowNull: true },
    failureReason: { type: DataTypes.TEXT, allowNull: true },
    failedAt: { type: DataTypes.DATE, allowNull: true },
    completedAt: { type: DataTypes.DATE, allowNull: true },
    /** Set atomically when admin payment email is sent (dedupes poll vs webhook). */
    notifiedAt: { type: DataTypes.DATE, allowNull: true },
    cancelledAt: { type: DataTypes.DATE, allowNull: true },
    retryOf: { type: DataTypes.INTEGER, allowNull: true },
    retryCount: { type: DataTypes.INTEGER, defaultValue: 0 },
    /** When set, this Payment row is for a specific layby installment (see layby_payments.id). */
    laybyPaymentId: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: { model: 'layby_payments', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL'
    },
    metadata: { type: DataTypes.JSON, allowNull: true, defaultValue: {} }
}, {
    tableName: 'payments',
    timestamps: true
});

Payment.mapLencoStatusToPaymentStatus = mapLencoStatusToPaymentStatus;

Payment.prototype.mapLencoStatusToPaymentStatus = function(lencoStatus) {
    return mapLencoStatusToPaymentStatus(lencoStatus);
};

Payment.prototype.updateLencoStatus = async function(status, response = null) {
    this.lencoStatus = status;
    this.status = mapLencoStatusToPaymentStatus(status);
    if (response) this.lencoResponse = response;
    return this.save();
};

Payment.prototype.markWebhookReceived = async function(payload) {
    this.webhookReceived = true;
    this.webhookPayload = payload;
    this.webhookReceivedAt = new Date();
    return this.save();
};

Object.defineProperty(Payment.prototype, 'isExpired', {
    get() { return this.expiresAt ? new Date() > this.expiresAt : false; }
});

Object.defineProperty(Payment.prototype, 'isLencoPayment', {
    get() { return !!(this.lencoTransactionId || this.lencoReference); }
});

Payment.findByLencoTransactionId = function(transactionId) {
    return this.findOne({ where: { lencoTransactionId: transactionId } });
};

Payment.findByLencoReference = function(reference) {
    return this.findOne({ where: { lencoReference: reference } });
};

Payment.findByTransactionId = function(transactionId) {
    return this.findOne({
        where: { [Op.or]: [{ transactionId: transactionId }, { lencoTransactionId: transactionId }] }
    });
};

Payment.findByOrderNumber = function(orderNumber) {
    return this.findOne({ where: { orderNumber } });
};

/** All gateway payments for an order, oldest first. */
Payment.findPaymentsByOrderNumber = function(orderNumber) {
    return this.findAll({
        where: { orderNumber },
        order: [['createdAt', 'ASC']]
    });
};

/** Latest payment row for an order (admin UI / enrichment). */
Payment.findLatestPaymentByOrderNumber = function(orderNumber) {
    return this.findOne({
        where: { orderNumber },
        order: [['createdAt', 'DESC']]
    });
};

Payment.findPendingPayments = function() {
    return this.findAll({ where: { status: 'pending' } });
};

Payment.findExpiredPayments = function() {
    return this.findAll({
        where: { status: 'pending', expiresAt: { [Op.lt]: new Date() } }
    });
};


module.exports = Payment;
