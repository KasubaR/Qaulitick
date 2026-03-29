const { Op } = require('sequelize');

function convertValue(v) {
    if (v && typeof v === 'object' && !(v instanceof Date) && !Array.isArray(v)) {
        if (v.$lte !== undefined) return { [Op.lte]: v.$lte };
        if (v.$gte !== undefined) return { [Op.gte]: v.$gte };
        if (v.$lt !== undefined) return { [Op.lt]: v.$lt };
        if (v.$gt !== undefined) return { [Op.gt]: v.$gt };
        if (v.$ne !== undefined) return { [Op.ne]: v.$ne };
        if (v.$in !== undefined) return { [Op.in]: v.$in };
        if (v.$nin !== undefined) return { [Op.notIn]: v.$nin };
    }
    return v;
}

function mongooseWhereToSequelize(where) {
    if (!where || typeof where !== 'object') return {};
    const out = {};
    for (const [k, v] of Object.entries(where)) {
        if (k === '_id') out.id = convertValue(v);
        else if (k === '$or') out[Op.or] = v.map(mongooseWhereToSequelize);
        else if (k === '$and') out[Op.and] = v.map(mongooseWhereToSequelize);
        else out[k] = convertValue(v);
    }
    return out;
}

function sortToOrder(sort) {
    if (!sort || typeof sort !== 'object') return undefined;
    return Object.entries(sort).map(([col, dir]) => [col, dir === 1 || dir === 'asc' ? 'ASC' : 'DESC']);
}

function findChain(Model, where) {
    const opts = { where: mongooseWhereToSequelize(where) };
    const chain = {
        sort(s) { opts.order = sortToOrder(s); return chain; },
        skip(n) { opts.offset = n; return chain; },
        limit(n) { opts.limit = n; return chain; },
        select(fields) {
            opts.attributes = Array.isArray(fields) ? fields : (typeof fields === 'string' ? fields.split(/\s+/) : undefined);
            return chain;
        },
        lean() { return chain; },
        async exec() { return Model.findAll(opts); },
        then(resolve, reject) { return this.exec().then(resolve, reject); }
    };
    return chain;
}

function addMongooseCompat(Model) {
    if (!Model.findById) {
        Model.findById = function(id) {
            const pk = parseInt(String(id), 10);
            return Number.isNaN(pk) ? null : Model.findByPk(pk);
        };
    }
    if (!Model.findByIdAndUpdate) {
        Model.findByIdAndUpdate = async function(id, update, opts = {}) {
            const pk = parseInt(String(id), 10);
            if (Number.isNaN(pk)) return null;
            const [count] = await Model.update(update, { where: { id: pk } });
            if (count === 0) return null;
            return opts.new !== false ? Model.findByPk(pk) : { id: pk };
        };
    }
    if (!Model.findByIdAndDelete) {
        Model.findByIdAndDelete = async function(id) {
            const doc = await Model.findById(id);
            if (doc) await doc.destroy();
            return doc;
        };
    }
    if (!Model.find) {
        Model.find = function(where) { return findChain(Model, where || {}); };
    }
}

const Product = require('./Product.model');
const Order = require('./Order.model');
const Payment = require('./Payment.model');
const FlashSale = require('./FlashSale.model');
const FeaturedProduct = require('./FeaturedProduct.model');
const ContactSubmission = require('./ContactSubmission.model');
const Settings = require('./Settings.model');
const Admin = require('./Admin.model');
const User = require('./User.model');
const PasswordResetToken = require('./PasswordResetToken.model');
const LaybyPlan = require('./LaybyPlan.model');
const LaybyPayment = require('./LaybyPayment.model');
const NewsletterSubscriber = require('./NewsletterSubscriber.model');
const NewsletterSubscribeAttempt = require('./NewsletterSubscribeAttempt.model');

User.hasMany(Order, { foreignKey: 'userId', as: 'orders' });
Order.belongsTo(User, { foreignKey: 'userId', as: 'user' });

User.hasMany(PasswordResetToken, { foreignKey: 'userId', as: 'passwordResetTokens' });
PasswordResetToken.belongsTo(User, { foreignKey: 'userId', as: 'user' });

User.hasMany(LaybyPlan, { foreignKey: 'userId', as: 'laybyPlans' });
LaybyPlan.belongsTo(User, { foreignKey: 'userId', as: 'user' });

Order.hasOne(LaybyPlan, { foreignKey: 'orderId', as: 'laybyPlan' });
LaybyPlan.belongsTo(Order, { foreignKey: 'orderId', as: 'order' });

LaybyPlan.hasMany(LaybyPayment, { foreignKey: 'laybyPlanId', as: 'laybyPayments' });
LaybyPayment.belongsTo(LaybyPlan, { foreignKey: 'laybyPlanId', as: 'laybyPlan' });

Payment.hasMany(LaybyPayment, { foreignKey: 'paymentId', as: 'laybyInstallments' });
LaybyPayment.belongsTo(Payment, { foreignKey: 'paymentId', as: 'payment' });

[Product, Order, Payment, FlashSale, FeaturedProduct, ContactSubmission, Settings, Admin, User, PasswordResetToken, LaybyPlan, LaybyPayment, NewsletterSubscriber, NewsletterSubscribeAttempt].forEach(addMongooseCompat);

module.exports = {
    Product,
    Order,
    Payment,
    FlashSale,
    FeaturedProduct,
    ContactSubmission,
    Settings,
    Admin,
    User,
    PasswordResetToken,
    LaybyPlan,
    LaybyPayment,
    NewsletterSubscriber,
    NewsletterSubscribeAttempt
};
