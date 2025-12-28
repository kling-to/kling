/**
 * Klaviyo Import Utilities
 *
 * Parse and transform Klaviyo export data to Kling format.
 * Supports CSV and JSON formats from Klaviyo exports.
 */
import Papa from 'papaparse';
// Klaviyo event type to Kling event type mapping
export const EVENT_TYPE_MAP = {
    'Placed Order': 'order_placed',
    'Ordered Product': 'order_placed',
    'Fulfilled Order': 'order_fulfilled',
    'Cancelled Order': 'order_cancelled',
    'Refunded Order': 'order_refunded',
    'Started Checkout': 'abandoned_cart',
    'Added to Cart': 'added_to_cart',
    'Viewed Product': 'viewed_product',
    'Searched Site': 'searched_site',
    'Subscribed to List': 'customer_joined_list',
    Unsubscribed: 'unsubscribed',
    'Received Email': 'email_received',
    'Opened Email': 'email_opened',
    'Clicked Email': 'email_clicked',
    'Marked Email as Spam': 'email_marked_spam',
    'Received SMS': 'sms_received',
    'Clicked SMS': 'sms_clicked',
};
// Klaviyo segment operator to Kling operator mapping
export const OPERATOR_MAP = {
    equals: 'eq',
    'does not equal': 'neq',
    contains: 'contains',
    'does not contain': 'notContains',
    'starts with': 'startsWith',
    'ends with': 'endsWith',
    'greater than': 'gt',
    'greater than or equal to': 'gte',
    'less than': 'lt',
    'less than or equal to': 'lte',
    'is set': 'isNotNull',
    'is not set': 'isNull',
    'is in': 'in',
    'is not in': 'notIn',
};
/**
 * Parse Klaviyo CSV export to Kling customer format
 */
export function parseKlaviyoProfileCSV(csvContent) {
    const result = {
        total: 0,
        imported: 0,
        skipped: 0,
        failed: 0,
        errors: [],
        warnings: [],
    };
    const parsed = Papa.parse(csvContent, {
        header: true,
        skipEmptyLines: true,
        transformHeader: (header) => header.trim(),
    });
    if (parsed.errors.length > 0) {
        for (const error of parsed.errors) {
            result.errors.push({
                row: error.row,
                message: error.message,
            });
        }
    }
    const customers = [];
    result.total = parsed.data.length;
    for (let i = 0; i < parsed.data.length; i++) {
        const row = parsed.data[i];
        const rowNum = i + 2; // Account for header row
        try {
            // Must have email or phone
            const email = row.Email?.trim().toLowerCase();
            const phone = row['Phone Number']?.trim();
            if (!email && !phone) {
                result.skipped++;
                result.warnings.push(`Row ${rowNum}: Skipped - no email or phone`);
                continue;
            }
            // Validate email format
            if (email && !isValidEmail(email)) {
                result.failed++;
                result.errors.push({
                    row: rowNum,
                    field: 'Email',
                    message: `Invalid email format: ${email}`,
                });
                continue;
            }
            // Extract custom properties (non-standard columns)
            const metadata = {};
            const standardFields = [
                'Email',
                'Phone Number',
                'First Name',
                'Last Name',
                'Title',
                'Organization',
                'City',
                'Region',
                'Zip',
                'Country',
                'Timezone',
                'Created Date',
                'Last Updated',
                'Email Consent',
                'SMS Consent',
            ];
            for (const [key, value] of Object.entries(row)) {
                if (!standardFields.includes(key) && value) {
                    metadata[snakeToCamel(key)] = value;
                }
            }
            const customer = {
                email: email || undefined,
                phone: normalizePhone(phone),
                firstName: row['First Name']?.trim(),
                lastName: row['Last Name']?.trim(),
                metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
                emailConsent: parseConsent(row['Email Consent']),
                smsConsent: parseConsent(row['SMS Consent']),
                source: 'klaviyo_import',
            };
            customers.push(customer);
            result.imported++;
        }
        catch (error) {
            result.failed++;
            result.errors.push({
                row: rowNum,
                message: error instanceof Error ? error.message : 'Unknown error',
            });
        }
    }
    return { customers, result };
}
/**
 * Parse Klaviyo API JSON profiles to Kling format
 */
export function parseKlaviyoProfileAPI(profiles) {
    const result = {
        total: profiles.length,
        imported: 0,
        skipped: 0,
        failed: 0,
        errors: [],
        warnings: [],
    };
    const customers = [];
    for (const profile of profiles) {
        try {
            const attrs = profile.attributes;
            if (!attrs.email && !attrs.phone_number && !attrs.external_id) {
                result.skipped++;
                result.warnings.push(`Profile ${profile.id}: Skipped - no identifier`);
                continue;
            }
            // Extract consent data
            const emailSub = attrs.subscriptions?.email?.marketing;
            const smsSub = attrs.subscriptions?.sms?.marketing;
            const customer = {
                email: attrs.email?.toLowerCase(),
                phone: normalizePhone(attrs.phone_number),
                firstName: attrs.first_name,
                lastName: attrs.last_name,
                externalId: attrs.external_id,
                metadata: attrs.properties,
                emailConsent: emailSub?.can_receive_email_marketing ?? false,
                emailConsentDate: emailSub?.consent_timestamp
                    ? new Date(emailSub.consent_timestamp)
                    : undefined,
                smsConsent: smsSub?.can_receive_sms_marketing ?? false,
                smsConsentDate: smsSub?.consent_timestamp ? new Date(smsSub.consent_timestamp) : undefined,
                source: 'klaviyo_import',
            };
            customers.push(customer);
            result.imported++;
        }
        catch (error) {
            result.failed++;
            result.errors.push({
                id: profile.id,
                message: error instanceof Error ? error.message : 'Unknown error',
            });
        }
    }
    return { customers, result };
}
/**
 * Parse Klaviyo events to Kling format
 */
export function parseKlaviyoEvents(events, metricNameMap) {
    const result = {
        total: events.length,
        imported: 0,
        skipped: 0,
        failed: 0,
        errors: [],
        warnings: [],
    };
    const parsedEvents = [];
    for (const event of events) {
        try {
            const attrs = event.attributes;
            const metricName = metricNameMap[attrs.metric_id] || 'custom_event';
            const eventType = EVENT_TYPE_MAP[metricName] || 'custom_event';
            // Extract event data
            const eventData = {
                klaviyoEventId: attrs.uuid,
                ...attrs.event_properties,
            };
            // Map order data if present
            if (attrs.event_properties.Items) {
                eventData.items = attrs.event_properties.Items.map((item) => ({
                    sku: item.SKU,
                    productId: item.ProductID,
                    name: item.ProductName,
                    quantity: item.Quantity,
                    price: item.ItemPrice,
                    url: item.ProductURL,
                    imageUrl: item.ImageURL,
                }));
            }
            if (attrs.event_properties.$value) {
                eventData.value = attrs.event_properties.$value;
            }
            parsedEvents.push({
                profileId: attrs.profile_id,
                event: {
                    type: eventType,
                    data: eventData,
                    occurredAt: new Date(attrs.timestamp),
                },
            });
            result.imported++;
        }
        catch (error) {
            result.failed++;
            result.errors.push({
                id: event.id,
                message: error instanceof Error ? error.message : 'Unknown error',
            });
        }
    }
    return { events: parsedEvents, result };
}
/**
 * Parse Klaviyo list CSV with profile emails
 */
export function parseKlaviyoListCSV(csvContent, listName) {
    const result = {
        total: 0,
        imported: 0,
        skipped: 0,
        failed: 0,
        errors: [],
        warnings: [],
    };
    const parsed = Papa.parse(csvContent, {
        header: true,
        skipEmptyLines: true,
    });
    const emails = [];
    result.total = parsed.data.length;
    for (let i = 0; i < parsed.data.length; i++) {
        const row = parsed.data[i];
        const email = row.Email?.trim().toLowerCase();
        if (!email) {
            result.skipped++;
            continue;
        }
        if (!isValidEmail(email)) {
            result.failed++;
            result.errors.push({
                row: i + 2,
                field: 'Email',
                message: `Invalid email: ${email}`,
            });
            continue;
        }
        emails.push(email);
        result.imported++;
    }
    return { listName, emails, result };
}
/**
 * Translate Klaviyo segment definition to Kling query DSL
 */
export function translateSegmentDefinition(klaviyoDefinition, metricNameMap = {}) {
    const unsupported = [];
    // Condition groups are joined with AND
    // Conditions within a group are joined with OR
    const andConditions = [];
    for (const group of klaviyoDefinition.condition_groups) {
        if (group.conditions.length === 0)
            continue;
        if (group.conditions.length === 1) {
            const translated = translateCondition(group.conditions[0], metricNameMap, unsupported);
            if (translated) {
                andConditions.push(translated);
            }
        }
        else {
            // Multiple conditions in group = OR
            const orConditions = [];
            for (const condition of group.conditions) {
                const translated = translateCondition(condition, metricNameMap, unsupported);
                if (translated) {
                    orConditions.push(translated);
                }
            }
            if (orConditions.length > 0) {
                andConditions.push({ or: orConditions });
            }
        }
    }
    if (andConditions.length === 0) {
        return { dsl: {}, unsupported };
    }
    if (andConditions.length === 1) {
        return { dsl: andConditions[0], unsupported };
    }
    return { dsl: { and: andConditions }, unsupported };
}
function translateCondition(condition, metricNameMap, unsupported) {
    const operator = OPERATOR_MAP[condition.operator.toLowerCase()] || condition.operator;
    switch (condition.type) {
        case 'profile_property': {
            const field = snakeToCamel(condition.property || '');
            return { [field]: { [operator]: condition.value } };
        }
        case 'metric': {
            const metricName = condition.metric_id
                ? metricNameMap[condition.metric_id] || 'custom_event'
                : 'custom_event';
            const eventType = EVENT_TYPE_MAP[metricName] || metricName;
            // Convert to aggregation
            return {
                aggregation: {
                    type: 'event_count',
                    eventType,
                    operator,
                    value: condition.value,
                    params: condition.timeframe ? { days: parseTimeframe(condition.timeframe) } : {},
                },
            };
        }
        case 'list_membership':
            // List membership requires special handling
            unsupported.push(`List membership condition: ${JSON.stringify(condition)}`);
            return null;
        case 'segment_membership':
            // Segment membership is complex - would need to inline segment definition
            unsupported.push(`Segment membership condition: ${JSON.stringify(condition)}`);
            return null;
        default:
            unsupported.push(`Unknown condition type: ${condition.type}`);
            return null;
    }
}
// Helper functions
function isValidEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}
function normalizePhone(phone) {
    if (!phone)
        return undefined;
    // Remove all non-digit characters except leading +
    const cleaned = phone.replace(/[^\d+]/g, '');
    if (!cleaned)
        return undefined;
    // Ensure E.164 format
    if (!cleaned.startsWith('+')) {
        // Assume US if no country code
        return `+1${cleaned}`;
    }
    return cleaned;
}
function parseConsent(value) {
    if (!value)
        return false;
    const lower = value.toLowerCase();
    return lower === 'true' || lower === 'yes' || lower === 'subscribed' || lower === '1';
}
function snakeToCamel(str) {
    return str
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/_([a-z])/g, (_, letter) => letter.toUpperCase())
        .replace(/^_/, '')
        .replace(/_$/, '');
}
function parseTimeframe(timeframe) {
    // Parse Klaviyo timeframe like "30 days" to number of days
    const match = timeframe.match(/(\d+)\s*(day|week|month|year)/i);
    if (!match)
        return 30; // Default to 30 days
    const value = parseInt(match[1], 10);
    const unit = match[2].toLowerCase();
    switch (unit) {
        case 'week':
            return value * 7;
        case 'month':
            return value * 30;
        case 'year':
            return value * 365;
        default:
            return value;
    }
}
/**
 * Validate import data before processing
 */
export function validateImportData(data, type) {
    const errors = [];
    // Check if it's a string (CSV) or object (JSON)
    if (typeof data === 'string') {
        // Try parsing as CSV
        const parsed = Papa.parse(data, { header: true, preview: 5 });
        if (parsed.errors.length > 0) {
            errors.push(...parsed.errors.map((e) => e.message));
        }
        const recordCount = Papa.parse(data, { header: true }).data.length;
        // Validate expected columns based on type
        if (type === 'profiles') {
            const headers = parsed.meta.fields || [];
            if (!headers.includes('Email') && !headers.includes('Phone Number')) {
                errors.push('CSV must contain Email or Phone Number column');
            }
        }
        return {
            valid: errors.length === 0,
            format: 'csv',
            recordCount,
            errors,
        };
    }
    if (typeof data === 'object' && data !== null) {
        // Check if it's a Klaviyo API response
        if (Array.isArray(data)) {
            if (data.length === 0) {
                return { valid: true, format: 'json', recordCount: 0, errors: [] };
            }
            const first = data[0];
            if (first && typeof first === 'object' && 'type' in first) {
                const expectedType = type === 'profiles' ? 'profile' : type === 'lists' ? 'list' : 'event';
                if (first.type !== expectedType) {
                    errors.push(`Expected ${expectedType} records, got ${first.type}`);
                }
            }
            return {
                valid: errors.length === 0,
                format: 'json',
                recordCount: data.length,
                errors,
            };
        }
        // Check for Klaviyo API wrapper format
        if ('data' in data && Array.isArray(data.data)) {
            return validateImportData(data.data, type);
        }
    }
    errors.push('Unrecognized data format');
    return { valid: false, format: 'unknown', recordCount: 0, errors };
}
