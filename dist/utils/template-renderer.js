/**
 * Template Renderer Utility
 *
 * Handles rendering of message content with placeholder substitution.
 * Supports email (with subject, body, html) and SMS.
 */
// Character limits for validation/warnings
export const CHANNEL_LIMITS = {
    sms: {
        body: 160, // Single SMS segment
        bodyWarn: 160,
    },
    email: {
        subject: 200,
        preheader: 100,
    },
};
/**
 * Substitute placeholders in a template string.
 * Supports {{placeholder}} syntax with optional whitespace.
 */
export function substituteplaceholders(template, data) {
    let result = template;
    for (const [key, value] of Object.entries(data)) {
        if (value !== undefined) {
            result = result.replace(new RegExp(`{{\\s*${key}\\s*}}`, 'g'), value);
        }
    }
    return result;
}
/**
 * Render email content with placeholder substitution
 */
export function renderEmailContent(email, data) {
    const rendered = {
        subject: substituteplaceholders(email.subject, data),
        body: substituteplaceholders(email.body, data),
    };
    if (email.preheader) {
        rendered.preheader = substituteplaceholders(email.preheader, data);
    }
    if (email.html) {
        rendered.html = substituteplaceholders(email.html, data);
    }
    // Append signature if present
    if (email.signature) {
        const renderedSignature = substituteplaceholders(email.signature, data);
        rendered.body = `${rendered.body}\n\n${renderedSignature}`;
        if (rendered.html) {
            rendered.html = `${rendered.html}<br><br>${renderedSignature.replace(/\n/g, '<br>')}`;
        }
    }
    return rendered;
}
/**
 * Render SMS content with placeholder substitution
 */
export function renderSmsContent(sms, data) {
    return {
        body: substituteplaceholders(sms.body, data),
    };
}
/**
 * Validate content against channel limits.
 * Returns warnings for content that exceeds recommended limits.
 */
export function validateContentLimits(channel, content) {
    const warnings = [];
    switch (channel) {
        case 'sms': {
            const smsContent = content;
            if (smsContent.body.length > CHANNEL_LIMITS.sms.body) {
                warnings.push(`SMS body exceeds ${CHANNEL_LIMITS.sms.body} chars (${smsContent.body.length} chars). May be split into multiple messages.`);
            }
            break;
        }
        case 'email': {
            const emailContent = content;
            if (emailContent.subject.length > CHANNEL_LIMITS.email.subject) {
                warnings.push(`Email subject exceeds ${CHANNEL_LIMITS.email.subject} chars (${emailContent.subject.length} chars). May be truncated in inbox.`);
            }
            if (emailContent.preheader &&
                emailContent.preheader.length > CHANNEL_LIMITS.email.preheader) {
                warnings.push(`Email preheader exceeds ${CHANNEL_LIMITS.email.preheader} chars (${emailContent.preheader.length} chars). May be truncated.`);
            }
            break;
        }
    }
    return warnings;
}
/**
 * Render a product recommendations HTML block for email templates.
 * Generates a responsive table-based layout compatible with email clients.
 */
export function renderRecommendationsBlock(recommendations, config = {}) {
    const { columns = 3, showPrice = true, showReason = false, buttonText = 'Shop Now', currency = '$', } = config;
    if (recommendations.length === 0) {
        return '';
    }
    // Generate table rows with products in columns
    const rows = [];
    for (let i = 0; i < recommendations.length; i += columns) {
        const rowItems = recommendations.slice(i, i + columns);
        const cells = rowItems
            .map((item) => {
            const priceText = showPrice
                ? `<p style="font-size: 16px; font-weight: bold; color: #333; margin: 8px 0;">${currency}${item.price.toFixed(2)}</p>`
                : '';
            const reasonText = showReason && item.reason
                ? `<p style="font-size: 12px; color: #666; font-style: italic; margin: 4px 0;">${item.reason}</p>`
                : '';
            const imageHtml = item.imageUrl
                ? `<img src="${item.imageUrl}" alt="${item.name}" style="max-width: 100%; height: auto; border-radius: 8px;" />`
                : `<div style="background: #f0f0f0; height: 150px; border-radius: 8px; display: flex; align-items: center; justify-content: center;">No Image</div>`;
            return `
        <td style="width: ${100 / columns}%; padding: 12px; vertical-align: top; text-align: center;">
          ${item.url ? `<a href="${item.url}" style="text-decoration: none; color: inherit;">` : ''}
          ${imageHtml}
          <p style="font-size: 14px; font-weight: 500; color: #333; margin: 12px 0 4px 0; line-height: 1.3;">${item.name}</p>
          ${item.brand ? `<p style="font-size: 12px; color: #666; margin: 0;">${item.brand}</p>` : ''}
          ${priceText}
          ${reasonText}
          ${item.url ? `<a href="${item.url}" style="display: inline-block; margin-top: 8px; padding: 10px 20px; background-color: #007bff; color: #fff; text-decoration: none; border-radius: 4px; font-size: 14px;">${buttonText}</a>` : ''}
          ${item.url ? '</a>' : ''}
        </td>
      `;
        })
            .join('');
        // Pad with empty cells if row is not full
        const emptyCells = columns - rowItems.length;
        const padding = emptyCells > 0
            ? Array(emptyCells)
                .fill(`<td style="width: ${100 / columns}%; padding: 12px;"></td>`)
                .join('')
            : '';
        rows.push(`<tr>${cells}${padding}</tr>`);
    }
    return `
    <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin: 20px 0;">
      <tbody>
        ${rows.join('')}
      </tbody>
    </table>
  `.trim();
}
/**
 * Add individual recommendation placeholders to template data.
 * Supports rec1_name, rec1_url, rec1_price, rec1_image, rec1_brand, rec1_category (up to 6 products)
 */
export function addRecommendationPlaceholders(data, recommendations, config = {}) {
    const { currency = '$' } = config;
    // Add individual product placeholders (rec1, rec2, ... rec6)
    for (let i = 0; i < Math.min(recommendations.length, 6); i++) {
        const rec = recommendations[i];
        const prefix = `rec${i + 1}`;
        data[`${prefix}_name`] = rec.name;
        data[`${prefix}_url`] = rec.url || '';
        data[`${prefix}_price`] = `${currency}${rec.price.toFixed(2)}`;
        data[`${prefix}_image`] = rec.imageUrl || '';
        data[`${prefix}_brand`] = rec.brand || '';
        data[`${prefix}_category`] = rec.category || '';
        data[`${prefix}_sku`] = rec.sku;
        data[`${prefix}_reason`] = rec.reason;
    }
    // Add the full HTML block as {{recommendations}}
    data.recommendations = renderRecommendationsBlock(recommendations, config);
    // Add count for conditional logic
    data.recommendation_count = recommendations.length.toString();
    return data;
}
/**
 * Create template data from customer and promo info
 */
export function buildTemplateData(customer, promo, product, recommendations) {
    const data = {
        name: customer.name || 'Customer',
        email: customer.email || '',
        phone: customer.phone || '',
    };
    if (customer.firstName) {
        data.firstName = customer.firstName;
    }
    if (customer.lastName) {
        data.lastName = customer.lastName;
    }
    if (promo) {
        if (promo.code) {
            data.code = promo.code;
            data.promo_code = promo.code;
        }
        if (promo.formattedValue) {
            if (promo.type === 'discount') {
                data.discount = promo.formattedValue;
            }
            else if (promo.type === 'gift') {
                data.gift = promo.formattedValue;
            }
        }
    }
    // Add product data for browse abandonment flows
    if (product) {
        if (product.productId)
            data.productId = product.productId;
        if (product.productName)
            data.productName = product.productName;
        if (product.productUrl)
            data.productUrl = product.productUrl;
        if (product.productImage)
            data.productImage = product.productImage;
        if (product.price !== undefined) {
            data.price = typeof product.price === 'number' ? product.price.toFixed(2) : product.price;
        }
        if (product.currency)
            data.currency = product.currency;
        if (product.category)
            data.category = product.category;
        if (product.brand)
            data.brand = product.brand;
        if (product.sku)
            data.sku = product.sku;
    }
    // Add product recommendations ({{recommendations}} block + {{rec1_name}}, etc.)
    if (recommendations && recommendations.items.length > 0) {
        addRecommendationPlaceholders(data, recommendations.items, recommendations.config);
    }
    return data;
}
/**
 * Legacy: Render a simple inline template (backwards compatibility)
 */
export function renderInlineTemplate(template, data) {
    return substituteplaceholders(template, data);
}
