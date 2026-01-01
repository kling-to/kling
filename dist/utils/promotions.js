import crypto from 'crypto';
export function generateDiscountCode(prefix = 'SAVE') {
    const random = crypto.randomBytes(4).toString('hex').toUpperCase();
    return `${prefix}${random}`;
}
export function generateGiftCode(prefix = 'GIFT') {
    const random = crypto.randomBytes(6).toString('hex').toUpperCase();
    return `${prefix}-${random}`;
}
export function formatDiscountValue(type, value) {
    switch (type) {
        case 'percentage':
            return `${Math.round(value * 100)}% off`;
        case 'fixed_amount':
            return `$${value.toFixed(2)} off`;
        case 'free_shipping':
            return 'Free Shipping';
        default:
            return `${value}`;
    }
}
export function formatGiftValue(type, sku, value) {
    switch (type) {
        case 'free_sku':
            return sku ? `Free ${sku}` : 'Free Product';
        case 'free_sample':
            return value ? String(value) : 'Free Sample';
        case 'redemption_code':
            if (typeof value === 'number') {
                return `$${value.toFixed(2)} Gift Card`;
            }
            return value || 'Gift Code';
        default:
            return value ? String(value) : 'Free Gift';
    }
}
