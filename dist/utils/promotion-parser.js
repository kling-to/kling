import OpenAI from 'openai';
import { zodTextFormat } from 'openai/helpers/zod';
import { z } from 'zod';
let openai = null;
function getOpenAIClient() {
    if (!openai && process.env.OPENAI_API_KEY) {
        openai = new OpenAI({
            apiKey: process.env.OPENAI_API_KEY,
        });
    }
    return openai;
}
export const ActionSchema = z.object({
    type: z.enum(['discount', 'gift']),
    discountType: z.enum(['percentage', 'fixed_amount', 'free_shipping']).nullable(),
    discountValue: z.number().nullable(),
    giftType: z.enum(['free_sku', 'free_sample', 'redemption_code']).nullable(),
    sku: z.string().nullable(),
    giftValue: z.number().nullable(),
    code: z.string().nullable(),
});
export const ConstraintsSchema = z.object({
    maxUsesTotal: z.number().nullable(),
    maxUsesPerCustomer: z.number().nullable(),
    minOrderValue: z.number().nullable(),
    stackable: z.boolean().nullable(),
});
export const PromotionDSLSchema = z.object({
    name: z.string(),
    description: z.string().nullable(),
    action: ActionSchema,
    query: z.record(z.string(), z.unknown()),
    schedule: z.object({
        cron: z.string().nullable(),
        startAt: z.string(),
        endAt: z.string(),
        immediate: z.boolean(),
    }),
    messageTemplate: z.string(),
    channel: z.enum(['email', 'sms']),
    constraints: ConstraintsSchema.nullable(),
    testPreview: z.boolean(),
});
const LLMPromotionResponseSchema = z.object({
    valid: z.boolean(),
    rejected: z.boolean().nullable(),
    reason: z.string().nullable(),
    category: z
        .enum(['gibberish', 'unrelated', 'unsafe', 'impossible', 'malicious', 'ambiguous'])
        .nullable(),
    name: z.string().nullable(),
    description: z.string().nullable(),
    actionType: z.enum(['discount', 'gift']).nullable(),
    discountType: z.enum(['percentage', 'fixed_amount', 'free_shipping']).nullable(),
    discountValue: z.number().nullable(),
    giftType: z.enum(['free_sku', 'free_sample', 'redemption_code']).nullable(),
    sku: z.string().nullable(),
    giftValue: z.number().nullable(),
    code: z.string().nullable(),
    queryJson: z.string().nullable(),
    cron: z.string().nullable(),
    startAt: z.string().nullable(),
    endAt: z.string().nullable(),
    immediate: z.boolean().nullable(),
    messageTemplate: z.string().nullable(),
    channel: z.enum(['email', 'sms']).nullable(),
    maxUsesTotal: z.number().nullable(),
    maxUsesPerCustomer: z.number().nullable(),
    minOrderValue: z.number().nullable(),
    stackable: z.boolean().nullable(),
    testPreview: z.boolean().nullable(),
});
const PROMOTION_SYSTEM_PROMPT = `You are a promotion DSL generator for a customer engagement platform.
Convert natural language descriptions into structured JSON for discounts and gifts.

RESPONSE FORMAT:
You must ALWAYS return valid JSON in ONE of these two formats:

FORMAT 1 - VALID PROMOTION (discount or gift):
{
  "valid": true,
  "rejected": null,
  "reason": null,
  "category": null,
  "name": "string (1-100 chars, descriptive name)",
  "description": "string or null",

  "actionType": "discount" | "gift",

  // FOR DISCOUNTS (actionType = "discount"):
  "discountType": "percentage" | "fixed_amount" | "free_shipping",
  "discountValue": number (0.1 for 10% off, 10 for $10 off, null for free_shipping),
  "giftType": null,
  "sku": null,
  "giftValue": null,
  "code": "DISCOUNT_CODE" or null,

  // FOR GIFTS (actionType = "gift"):
  "discountType": null,
  "discountValue": null,
  "giftType": "free_sku" | "free_sample" | "redemption_code",
  "sku": "PRODUCT-SKU" (for free_sku type) or null,
  "giftValue": number (monetary value) or null,
  "code": "GIFT_CODE" (for redemption_code type) or null,

  "queryJson": "JSON string of the query object",
  "cron": "cron expression" or null (null for immediate/one-time),
  "startAt": "ISO 8601 datetime",
  "endAt": "ISO 8601 datetime",
  "immediate": true | false,
  "messageTemplate": "string with {{name}}, {{code}}, {{discount}} placeholders",
  "channel": "email" | "sms",
  "maxUsesTotal": number or null (global cap),
  "maxUsesPerCustomer": number or null (per-customer limit, default 1),
  "minOrderValue": number or null,
  "stackable": true | false,
  "testPreview": true | false (true if user mentions "preview" or "test")
}

FORMAT 2 - INVALID/REJECTED:
{
  "valid": false,
  "rejected": true,
  "reason": "string explaining why",
  "category": "gibberish" | "unrelated" | "unsafe" | "impossible" | "malicious" | "ambiguous",
  // All other fields null
}

DISCOUNT RULES:
1. "percentage" type: discountValue < 1 (e.g., 0.1 = 10%, 0.25 = 25%)
2. "fixed_amount" type: discountValue >= 1 (e.g., 10 = $10 off, 50 = $50 off)
3. "free_shipping" type: discountValue = null
4. Always generate a unique code like "SAVE10", "VIP20", etc. unless specified

GIFT RULES:
1. "free_sku" type: requires sku field (product SKU to give away)
2. "free_sample" type: small free add-on, may have sku
3. "redemption_code" type: generates a code for redemption

QUERY DSL (same as campaign queries):
- Customer filters: totalOrders, totalSpent, lastOrderAt, optOut
- Order filters: orders.some/none/every with items
- Aggregations: favorite_category, category_count, avg_order_value, no_purchase_since, etc.

Example queryJson values:
- "{\\"totalSpent\\":{\\"gte\\":500}}" - VIP customers who spent $500+
- "{\\"aggregation\\":{\\"type\\":\\"no_purchase_since\\",\\"value\\":60}}" - Inactive 60+ days
- "{\\"aggregation\\":{\\"type\\":\\"favorite_category\\",\\"field\\":\\"Electronics\\"}}" - Electronics lovers
- "{\\"aggregation\\":{\\"type\\":\\"order_count\\",\\"operator\\":\\"gte\\",\\"value\\":5}}" - 5+ orders

MESSAGE TEMPLATE PLACEHOLDERS:
- {{name}} - Customer's name
- {{code}} - Discount/gift code
- {{discount}} - Discount amount/percentage
- {{gift}} - Gift description
- {{expiry}} - Expiration date

REJECTION CRITERIA:
1. GIBBERISH: Meaningless text
2. UNRELATED: Not about discounts/gifts/promotions
3. UNSAFE: Violates consent, targets opted-out customers
4. IMPOSSIBLE: Unmeasurable criteria ("customers who are happy")
5. MALICIOUS: Harmful intent
6. AMBIGUOUS: Unclear discount amount or target ("give a big discount")

Only output valid JSON, no explanations.`;
export async function parseNaturalLanguageToPromotionDSL(prompt, timezone = 'UTC') {
    const client = getOpenAIClient();
    if (!client) {
        return {
            success: false,
            error: 'OpenAI API key not configured (OPENAI_API_KEY)',
        };
    }
    try {
        const now = new Date();
        const oneYearFromNow = new Date(now);
        oneYearFromNow.setFullYear(oneYearFromNow.getFullYear() + 1);
        const userPrompt = `Current date: ${now.toISOString()}
Timezone: ${timezone}
Default start date: ${now.toISOString()}
Default end date: ${oneYearFromNow.toISOString()}

Convert this promotion description to JSON:
"${prompt}"`;
        const response = await client.responses.parse({
            model: 'gpt-4o-mini',
            input: [
                { role: 'system', content: PROMOTION_SYSTEM_PROMPT },
                { role: 'user', content: userPrompt },
            ],
            temperature: 0.1,
            max_output_tokens: 1500,
            text: {
                format: zodTextFormat(LLMPromotionResponseSchema, 'promotion_dsl'),
            },
        });
        if (response.status === 'incomplete') {
            return {
                success: false,
                error: `Incomplete response from LLM: ${response.incomplete_details?.reason || 'unknown'}`,
            };
        }
        const parsed = response.output_parsed;
        if (!parsed) {
            return {
                success: false,
                error: 'Empty response from LLM',
            };
        }
        const rawResponse = response.output_text;
        if (parsed.valid === false && parsed.rejected === true) {
            return {
                success: false,
                rejected: true,
                rejectionReason: parsed.reason || 'Prompt was rejected',
                rejectionCategory: parsed.category,
                rawResponse,
            };
        }
        if (!parsed.name ||
            !parsed.actionType ||
            !parsed.queryJson ||
            !parsed.startAt ||
            !parsed.endAt ||
            !parsed.messageTemplate ||
            !parsed.channel) {
            return {
                success: false,
                error: 'DSL validation failed: missing required fields',
                rawResponse,
            };
        }
        let query;
        try {
            query = JSON.parse(parsed.queryJson);
        }
        catch {
            return {
                success: false,
                error: 'DSL validation failed: invalid queryJson',
                rawResponse,
            };
        }
        const action = {
            type: parsed.actionType,
            discountType: parsed.discountType,
            discountValue: parsed.discountValue,
            giftType: parsed.giftType,
            sku: parsed.sku,
            giftValue: parsed.giftValue,
            code: parsed.code,
        };
        const constraints = parsed.maxUsesTotal ||
            parsed.maxUsesPerCustomer ||
            parsed.minOrderValue ||
            parsed.stackable !== null
            ? {
                maxUsesTotal: parsed.maxUsesTotal,
                maxUsesPerCustomer: parsed.maxUsesPerCustomer,
                minOrderValue: parsed.minOrderValue,
                stackable: parsed.stackable,
            }
            : null;
        const dsl = {
            name: parsed.name,
            description: parsed.description,
            action,
            query: processRelativeDates(query),
            schedule: {
                cron: parsed.cron,
                startAt: parsed.startAt,
                endAt: parsed.endAt,
                immediate: parsed.immediate ?? false,
            },
            messageTemplate: parsed.messageTemplate,
            channel: parsed.channel,
            constraints,
            testPreview: parsed.testPreview ?? false,
        };
        return {
            success: true,
            dsl,
            rawResponse,
        };
    }
    catch (err) {
        const errorMessage = err instanceof Error ? err.message : 'Unknown error';
        return {
            success: false,
            error: `LLM parsing failed: ${errorMessage}`,
        };
    }
}
function processRelativeDates(obj) {
    const result = {};
    for (const [key, value] of Object.entries(obj)) {
        if (typeof value === 'string' && value.includes('_days_ago')) {
            const daysMatch = value.match(/(\d+)_days_ago/);
            if (daysMatch) {
                const days = parseInt(daysMatch[1], 10);
                const date = new Date();
                date.setDate(date.getDate() - days);
                result[key] = date.toISOString();
            }
            else {
                result[key] = value;
            }
        }
        else if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
            result[key] = processRelativeDates(value);
        }
        else if (Array.isArray(value)) {
            result[key] = value.map((item) => typeof item === 'object' && item !== null
                ? processRelativeDates(item)
                : item);
        }
        else {
            result[key] = value;
        }
    }
    return result;
}
export function parseDiscountType(type) {
    const typeMap = {
        percentage: 'percentage',
        fixed_amount: 'fixed_amount',
        free_shipping: 'free_shipping',
    };
    return typeMap[type.toLowerCase()] || 'percentage';
}
export function parseGiftType(type) {
    const typeMap = {
        free_sku: 'free_sku',
        free_sample: 'free_sample',
        redemption_code: 'redemption_code',
    };
    return typeMap[type.toLowerCase()] || 'redemption_code';
}
export function parseChannel(channel) {
    const channelMap = {
        email: 'email',
        sms: 'sms',
    };
    return channelMap[channel.toLowerCase()] || 'email';
}
