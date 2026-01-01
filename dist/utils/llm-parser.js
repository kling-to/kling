import OpenAI from 'openai';
import { zodTextFormat } from 'openai/helpers/zod';
import { z } from 'zod';
import prisma from './prisma';
import { getFlowTemplates } from './flow-templates';
let openai = null;
let cachedApiKey = null;
async function getOpenAIClient() {
    const settings = await prisma.settings.findFirst();
    const apiKey = settings?.openaiApiKey;
    if (!apiKey) {
        return null;
    }
    if (!openai || cachedApiKey !== apiKey) {
        openai = new OpenAI({ apiKey });
        cachedApiKey = apiKey;
    }
    return openai;
}
export const DiscountSchema = z.object({
    type: z.enum(['percentage', 'fixed_amount', 'free_shipping']),
    value: z.number(),
    code: z.string().optional(),
});
export const GiftSchema = z.object({
    type: z.enum(['free_sku', 'free_sample', 'redemption_code']),
    sku: z.string().optional(),
    value: z.string().optional(),
});
export const CampaignDSLSchema = z.object({
    name: z.string(),
    description: z.string().nullable(),
    cron: z.string().nullable(),
    startAt: z.string(),
    endAt: z.string(),
    query: z.record(z.string(), z.unknown()),
    messageTemplate: z.string(),
    channel: z.enum(['email', 'sms']),
    conditions: z.record(z.string(), z.unknown()).nullable(),
    executionType: z.enum(['recurring', 'once']).optional(),
    discount: DiscountSchema.nullable().optional(),
    gift: GiftSchema.nullable().optional(),
    includeRecommendations: z.boolean().nullable().optional(),
    recommendationAlgorithm: z
        .enum([
        'best_sellers',
        'recently_viewed',
        'collaborative_filter',
        'copurchase',
        'content_based',
        'personalized_mix',
    ])
        .nullable()
        .optional(),
    recommendationLimit: z.number().nullable().optional(),
    excludePurchasedProducts: z.boolean().nullable().optional(),
});
const LLMResponseSchema = z.object({
    valid: z.boolean(),
    rejected: z.boolean().nullable(),
    reason: z.string().nullable(),
    category: z
        .enum(['gibberish', 'unrelated', 'unsafe', 'impossible', 'malicious', 'ambiguous'])
        .nullable(),
    name: z.string().nullable(),
    description: z.string().nullable(),
    cron: z.string().nullable(),
    startAt: z.string().nullable(),
    endAt: z.string().nullable(),
    queryJson: z.string().nullable(),
    messageTemplate: z.string().nullable(),
    channel: z.enum(['email', 'sms']).nullable(),
    conditionsJson: z.string().nullable(),
    executionType: z.enum(['recurring', 'once']).nullable(),
    discountJson: z.string().nullable(),
    giftJson: z.string().nullable(),
    includeRecommendations: z.boolean().nullable(),
    recommendationAlgorithm: z
        .enum([
        'best_sellers',
        'recently_viewed',
        'collaborative_filter',
        'copurchase',
        'content_based',
        'personalized_mix',
    ])
        .nullable(),
    recommendationLimit: z.number().nullable(),
    excludePurchasedProducts: z.boolean().nullable(),
});
const SYSTEM_PROMPT = `You are a campaign DSL generator for a customer engagement platform.
Convert natural language descriptions into structured JSON campaign definitions.

RESPONSE FORMAT:
You must ALWAYS return valid JSON in ONE of these two formats:

FORMAT 1 - VALID CAMPAIGN (when the prompt is a valid campaign request):
{
  "valid": true,
  "rejected": null,
  "reason": null,
  "category": null,
  "name": "string (1-100 chars, descriptive name)",
  "description": "string or null (optional, longer description)",
  "cron": "string (valid cron expression, e.g., '0 10 * * *' for daily at 10am)",
  "startAt": "string (ISO 8601 datetime for when to start)",
  "endAt": "string (ISO 8601 datetime for when to end)",
  "queryJson": "JSON string of the query object (must be valid JSON)",
  "messageTemplate": "string (message with {{name}}, {{email}}, {{code}}, {{discount}}, {{gift}}, {{recommendations}} placeholders)",
  "channel": "email" | "sms",
  "conditionsJson": "JSON string of conditions or null",
  "executionType": "recurring" | "once",
  "discountJson": "JSON string of discount object or null",
  "giftJson": "JSON string of gift object or null",
  "includeRecommendations": true | false | null,
  "recommendationAlgorithm": "best_sellers" | "recently_viewed" | "collaborative_filter" | "copurchase" | "content_based" | "personalized_mix" | null,
  "recommendationLimit": number (1-12) | null,
  "excludePurchasedProducts": true | false | null
}

FORMAT 2 - INVALID/REJECTED (when the prompt should be rejected):
{
  "valid": false,
  "rejected": true,
  "reason": "string explaining why this was rejected",
  "category": "gibberish" | "unrelated" | "unsafe" | "impossible" | "malicious" | "ambiguous",
  "name": null,
  "description": null,
  "cron": null,
  "startAt": null,
  "endAt": null,
  "queryJson": null,
  "messageTemplate": null,
  "channel": null,
  "conditionsJson": null,
  "executionType": null,
  "discountJson": null,
  "giftJson": null,
  "includeRecommendations": null,
  "recommendationAlgorithm": null,
  "recommendationLimit": null,
  "excludePurchasedProducts": null
}

IMPORTANT: The queryJson field must be a valid JSON STRING (escaped), not a JSON object.
Example: "queryJson": "{\\"aggregation\\":{\\"type\\":\\"category_count\\",\\"field\\":\\"Electronics\\",\\"value\\":3}}"

REJECTION CRITERIA - You MUST reject and return Format 2 for:

1. GIBBERISH/NONSENSE: Meaningless text, random words, no coherent campaign intent
   Example: "blurf the customer when the moon wiggles" → reject as "gibberish"

2. UNRELATED REQUESTS: General knowledge questions, non-campaign tasks
   Example: "Who won the World Cup in 1998?" → reject as "unrelated"

3. UNSAFE/CONSENT VIOLATIONS: Requests that violate user consent or privacy
   Example: "Send messages to customers who opted out" → reject as "unsafe"
   Example: "Message customers even if they unsubscribed" → reject as "unsafe"

4. IMPOSSIBLE/UNMEASURABLE: Criteria that cannot be determined from data
   Example: "Reward customers who seem sad" → reject as "impossible"
   Example: "Message customers who are thinking about buying" → reject as "impossible"

5. MALICIOUS REQUESTS: Hacking, data theft, harmful actions
   Example: "Hack competitor's database" → reject as "malicious"
   Example: "Steal customer data" → reject as "malicious"

6. AMBIGUOUS/UNCLEAR: Prompts too vague to create a reliable query without guessing
   Example: "Send a discount to customers who bought that thing they always buy" → reject as "ambiguous"
   Example: "Message customers who buy the expensive items" → reject as "ambiguous" (what is "expensive"?)
   Example: "Target customers who almost churned but came back" → reject as "ambiguous" (no clear definition)
   Example: "If they haven't bought in a really long time" → reject as "ambiguous" (how long is "really long"?)
   Example: "Tell customers about cool new stuff if they seem bored" → reject as "ambiguous" (cannot measure "bored")

QUERY DSL (for valid campaigns):
{
  // CUSTOMER FIELDS - filter on customer attributes:
  // {"totalOrders": {"gte": 1}} - customers with 1+ orders
  // {"totalSpent": {"gte": 100}} - customers who spent $100+
  // {"lastOrderAt": {"gte": "30_days_ago"}} - ordered in last 30 days
  // {"lastOrderAt": {"lte": "60_days_ago"}} - haven't ordered in 60+ days
  // {"optOut": false} - not opted out

  // NESTED BOOLEAN LOGIC (AND/OR/NOT):
  // Combine multiple conditions with boolean operators for complex targeting.
  // Maximum 100 conditions per query (Klaviyo parity).
  //
  // AND - All conditions must match (implicit at top level, explicit with "and"):
  // {"and": [{"totalOrders": {"gte": 5}}, {"totalSpent": {"gte": 500}}]}
  //
  // OR - Any condition must match:
  // {"or": [
  //   {"aggregation": {"type": "favorite_category", "field": "Electronics"}},
  //   {"aggregation": {"type": "favorite_category", "field": "Computers"}}
  // ]}
  //
  // NOT - Exclude matching customers:
  // {"not": {"aggregation": {"type": "favorite_category", "field": "AppleCare"}}}
  //
  // NESTED COMBINATIONS - Mix AND/OR/NOT for complex logic:
  // Example: "(Electronics buyers with AOV >= $200) OR (at-risk customers who purchased recently)"
  // {
  //   "or": [
  //     {"and": [
  //       {"aggregation": {"type": "favorite_category", "field": "Electronics"}},
  //       {"aggregation": {"type": "avg_order_value", "operator": "gte", "value": 200}}
  //     ]},
  //     {"and": [
  //       {"aggregation": {"type": "churn_risk", "value": 0.7}},
  //       {"aggregation": {"type": "recent_purchase", "value": 30}}
  //     ]}
  //   ],
  //   "not": {"aggregation": {"type": "favorite_category", "field": "AppleCare"}}
  // }
  //
  // Example: "VIP customers who are NOT in Electronics"
  // {
  //   "and": [
  //     {"aggregation": {"type": "total_order_value", "operator": "gte", "value": 1000}}
  //   ],
  //   "not": {"aggregation": {"type": "favorite_category", "field": "Electronics"}}
  // }

  // ORDER RELATION FILTERS - filter by order details:
  // Use "orders" with "some", "every", or "none" to filter by order properties
  //
  // Order fields: total, purchasedAt
  // OrderItem fields (nested in items): sku, name, category, price, quantity, brand
  //
  // Examples:
  // {"orders": {"some": {"total": {"gte": 200}}}} - has any order >= $200
  // {"orders": {"some": {"items": {"some": {"category": "shoes"}}}}} - bought shoes
  // {"orders": {"some": {"total": {"gte": 150}, "items": {"some": {"category": "shoes"}}}}} - bought shoes in order >= $150
  // {"orders": {"none": {"purchasedAt": {"gte": "30_days_ago"}}}} - no orders in 30 days
  // {"orders": {"some": {"items": {"some": {"name": {"contains": "laptop"}}}}}} - bought laptop

  // AGGREGATION QUERIES - for complex computed filters:
  // Use "aggregation" for queries that require counting/grouping across orders
  //
  // PURCHASE BEHAVIOR AGGREGATIONS:
  // - favorite_category: customer's most purchased category
  //   {"aggregation": {"type": "favorite_category", "field": "Electronics"}}
  // - favorite_brand: customer's most purchased brand
  //   {"aggregation": {"type": "favorite_brand", "field": "Nike"}}
  // - category_count: purchased a category at least N times
  //   {"aggregation": {"type": "category_count", "field": "Shoes", "value": 3}}
  // - brand_loyalty: purchased a brand at least N times
  //   {"aggregation": {"type": "brand_loyalty", "field": "Apple", "value": 5}}
  // - last_purchased_category: customer's most recent purchase was in category
  //   {"aggregation": {"type": "last_purchased_category", "field": "Clothing"}}
  // - purchased_product: bought a specific product (by name or SKU)
  //   {"aggregation": {"type": "purchased_product", "field": "iPhone 15"}}
  // - never_purchased_category: never bought from a category
  //   {"aggregation": {"type": "never_purchased_category", "field": "Electronics"}}
  // - cross_sell_candidates: bought category A but not category B
  //   {"aggregation": {"type": "cross_sell_candidates", "field": "Shoes", "field2": "Accessories"}}
  //
  // ORDER VALUE AGGREGATIONS:
  // - avg_order_value: average order value comparison (gte/lte/eq)
  //   {"aggregation": {"type": "avg_order_value", "operator": "gte", "value": 100}}
  // - median_order_value: median order value comparison (gte/lte)
  //   {"aggregation": {"type": "median_order_value", "operator": "gte", "value": 75}}
  // - total_order_value: lifetime total spending comparison
  //   {"aggregation": {"type": "total_order_value", "operator": "gte", "value": 500}}
  // - order_count: total number of orders comparison
  //   {"aggregation": {"type": "order_count", "operator": "gte", "value": 5}}
  // - high_value_item_buyer: bought items above a price threshold
  //   {"aggregation": {"type": "high_value_item_buyer", "value": 200}}
  // - category_spend: spent at least X in a specific category
  //   {"aggregation": {"type": "category_spend", "field": "Electronics", "operator": "gte", "value": 500}}
  // - discount_shopper: bought N+ discounted items
  //   {"aggregation": {"type": "discount_shopper", "value": 3}}
  //
  // TIMING & ACTIVITY AGGREGATIONS:
  // - recent_purchase: purchased within last N days
  //   {"aggregation": {"type": "recent_purchase", "value": 30}}
  // - no_purchase_since: hasn't purchased in N days
  //   {"aggregation": {"type": "no_purchase_since", "value": 90}}
  // - first_purchase: first purchase was within last N days (new customers)
  //   {"aggregation": {"type": "first_purchase", "value": 30}}
  // - most_active_hour: most orders placed at specific hour (0-23)
  //   {"aggregation": {"type": "most_active_hour", "value": 14}}
  // - most_active_day: most orders placed on day of week (0=Sun, 6=Sat)
  //   {"aggregation": {"type": "most_active_day", "value": 6}}
  // - seasonal_buyer: purchases in specific months (array of months 1-12)
  //   {"aggregation": {"type": "seasonal_buyer", "value": [11, 12]}}
  //
  // ENGAGEMENT & RETENTION AGGREGATIONS:
  // - churn_risk: customers at risk of churning (risk score 0-1 threshold)
  //   {"aggregation": {"type": "churn_risk", "value": 0.7}}
  // - repeat_purchase_rate: ratio of customers with multiple orders (gte/lte)
  //   {"aggregation": {"type": "repeat_purchase_rate", "operator": "gte", "value": 0.5}}
  // - retention_rate: cohort retention over N months
  //   {"aggregation": {"type": "retention_rate", "operator": "gte", "value": 0.3, "value2": 6}}
  // - upsell_conversion_rate: experiment conversion rate (requires experiments)
  //   {"aggregation": {"type": "upsell_conversion_rate", "operator": "gte", "value": 0.1}}
  //
  // BEHAVIOR PATTERN AGGREGATIONS:
  // - coupon_usage_rate: rate of orders with coupon codes (0-1)
  //   {"aggregation": {"type": "coupon_usage_rate", "operator": "gte", "value": 0.5}}
  // - refund_rate: rate of refunded orders (0-1)
  //   {"aggregation": {"type": "refund_rate", "operator": "lte", "value": 0.1}}
  // - return_count: number of returned/refunded orders
  //   {"aggregation": {"type": "return_count", "operator": "lte", "value": 2}}
  // - abandoned_cart_count: number of abandoned cart events
  //   {"aggregation": {"type": "abandoned_cart_count", "operator": "gte", "value": 1}}
  // - preferred_contact_channel: customer's preferred contact channel
  //   {"aggregation": {"type": "preferred_contact_channel", "field": "email"}}
  //
  // PREDICTIVE ANALYTICS AGGREGATIONS (requires predictions to be enabled):
  // - predicted_ltv: predicted lifetime value comparison (gte/lte/gt/lt)
  //   {"aggregation": {"type": "predicted_ltv", "operator": "gte", "value": 1000}}
  // - engagement_score: engagement score 0-100 comparison (gte/lte/gt/lt)
  //   {"aggregation": {"type": "engagement_score", "operator": "gte", "value": 50}}
  // - churn_risk_predicted: predicted churn risk 0-1 comparison (gte/lte/gt/lt)
  //   {"aggregation": {"type": "churn_risk_predicted", "operator": "gte", "value": 0.7}}
}

OPERATORS:
- eq: equals
- neq: not equals
- gt: greater than
- gte: greater than or equal
- lt: less than
- lte: less than or equal
- contains: string contains (case insensitive)
- in: value in array
- notIn: value not in array

CAMPAIGN RULES (for valid campaigns):
1. Cron expressions: minute hour day-of-month month day-of-week
   - "0 10 * * *" = daily at 10am
   - "0 14 * * 1" = Mondays at 2pm
   - "0 9 1 * *" = 1st of each month at 9am
2. For relative dates in query, use special strings like "30_days_ago", "7_days_ago", "90_days_ago"
3. Default channel is "email" unless SMS is mentioned
4. Always include a friendly message template with at least {{name}} placeholder
5. If no end date specified, default to 1 year from start
6. If no start date specified, default to now
7. executionType: "recurring" (runs on cron schedule) or "once" (runs immediately once)
   - Use "once" for one-time campaigns like welcome emails, thank you messages, or immediate promotions
   - Use "recurring" for ongoing campaigns that should repeat
   - Default to "once" if the prompt sounds like a one-time action (e.g., "send", "thank", "reward")
   - Default to "recurring" if the prompt implies ongoing/repeated actions (e.g., "weekly", "monthly", "every")

PROMOTIONS (discountJson and giftJson):
When the prompt mentions discounts, offers, or gifts, include the appropriate promotion field.

DISCOUNT TYPES (discountJson):
- percentage: Percentage off (value < 1, e.g., 0.15 = 15%, 0.20 = 20%)
  Example: "15% off" → {"type":"percentage","value":0.15}
  Example: "20% discount" → {"type":"percentage","value":0.20}
- fixed_amount: Fixed dollar amount off (value >= 1)
  Example: "$10 off" → {"type":"fixed_amount","value":10}
  Example: "$25 discount" → {"type":"fixed_amount","value":25}
- free_shipping: Free shipping (value is 0)
  Example: "free shipping" → {"type":"free_shipping","value":0}

GIFT TYPES (giftJson):
- free_sku: A specific free product by SKU
  Example: "free iPhone case SKU-123" → {"type":"free_sku","sku":"SKU-123","value":"iPhone case"}
- free_sample: A free sample or add-on item
  Example: "free t-shirt" → {"type":"free_sample","value":"t-shirt"}
  Example: "free sample kit" → {"type":"free_sample","value":"sample kit"}
- redemption_code: A code to redeem for something
  Example: "loyalty reward code" → {"type":"redemption_code","value":"loyalty reward"}

MESSAGE TEMPLATE PLACEHOLDERS:
- {{name}} - Customer's full name
- {{email}} - Customer's email
- {{phone}} - Customer's phone
- {{firstName}} - Customer's first name
- {{lastName}} - Customer's last name
- {{code}} - Promo/discount code (auto-generated)
- {{discount}} - Formatted discount value (e.g., "15% off", "$10 off")
- {{gift}} - Gift description

PRODUCT RECOMMENDATIONS PLACEHOLDERS:
- {{recommendations}} - Full HTML block with personalized product grid (for email)
- {{rec1_name}}, {{rec1_price}}, {{rec1_url}}, {{rec1_image}}, {{rec1_brand}} - First product
- {{rec2_name}}, {{rec2_price}}, {{rec2_url}}, {{rec2_image}}, {{rec2_brand}} - Second product
- ... up to {{rec6_name}}, etc. - Up to 6 products

PRODUCT RECOMMENDATIONS (includeRecommendations):
When the prompt mentions "product recommendations", "recommended products", "personalized products",
"you might like", "similar products", or "products for you":
- Set includeRecommendations: true
- Set recommendationAlgorithm based on context:
  * "personalized" / "for you" / "you might like" → "personalized_mix" (default)
  * "best sellers" / "popular" / "top selling" → "best_sellers"
  * "similar" / "like this" / "related" → "content_based"
  * "customers also bought" / "frequently bought together" → "copurchase"
  * "recently viewed" / "browsing history" → "recently_viewed"
- Set recommendationLimit: 3-6 (default 6)
- Set excludePurchasedProducts: true (exclude products customer already purchased)
- Include {{recommendations}} in the HTML template for a product grid block
- Or use individual placeholders like {{rec1_name}}, {{rec1_price}}, etc. for custom layouts

Example prompt: "Send an email with product recommendations to customers who haven't ordered in 30 days"
→ includeRecommendations: true, recommendationAlgorithm: "personalized_mix", recommendationLimit: 6

When a campaign has a discount or gift, include {{code}} and/or {{discount}}/{{gift}} in the message template.

BIRTHDAY CAMPAIGNS:
For birthday-related queries, use the "birthDate" field directly on the Customer model.
The birthDate field stores the customer's full birth date (DateTime).
To target customers with birthdays this week/month, use month and day matching:
- {"birthDate": {"monthDay": {"gte": "CURRENT_MONTH_DAY", "lte": "CURRENT_MONTH_DAY_PLUS_7"}}}
Or use the special "birthday_this_week" or "birthday_this_month" helpers:
- {"birthdayThisWeek": true} - customers whose birthday is in the current week
- {"birthdayThisMonth": true} - customers whose birthday is in the current month
DO NOT use lastOrderAt for birthday campaigns - that is for purchase timing, not birthdays!

WHEN TO USE AGGREGATION QUERIES vs SIMPLE QUERIES:
- Use AGGREGATION queries for computed/analytical conditions:
  * "favorite category/brand" → aggregation: favorite_category/favorite_brand
  * "last purchased category" → aggregation: last_purchased_category
  * "bought X product" → aggregation: purchased_product
  * "bought category A but not B" → aggregation: cross_sell_candidates
  * "X or more orders" / "order count" → aggregation: order_count
  * "items over $X" / "high value items" → aggregation: high_value_item_buyer
  * "spent $X in category" → aggregation: category_spend
  * "recent purchase in last N days" → aggregation: recent_purchase
  * "no purchase in N days" / "inactive" → aggregation: no_purchase_since
  * "seasonal/holiday buyers" / "buy in specific months" → aggregation: seasonal_buyer
  * "returns/refunds count" → aggregation: return_count
  * "abandoned carts" → aggregation: abandoned_cart_count
  * "high LTV" / "valuable customers" / "predicted value $X+" → aggregation: predicted_ltv
  * "engaged customers" / "engagement score X+" → aggregation: engagement_score
  * "at risk of churning" / "likely to churn" / "churn risk X+" → aggregation: churn_risk_predicted

- Use SIMPLE QUERIES (orders.some/none) only when:
  * Checking if ANY order contains specific item by name: orders.some.items.some.name
  * Checking order total for a SINGLE order: orders.some.total

WHEN TO USE NESTED AND/OR/NOT LOGIC:
Use nested boolean logic when the prompt contains:
- "or" / "either" / "any of" → use "or" wrapper
- "and" / "both" / "all of" → use "and" wrapper
- "but not" / "excluding" / "except" → use "not" wrapper
- Complex conditions: "(A or B) and C" → nest appropriately

Examples of prompts requiring nested logic:
- "VIP customers who love Electronics OR frequent buyers who haven't purchased in 30 days"
  → Use OR to combine two AND groups
- "Customers who bought shoes but not accessories"
  → Use NOT to exclude a category
- "Loyal customers in Electronics or Clothing, excluding those in AppleCare"
  → Use OR for categories, NOT for exclusion

Only output valid JSON, no explanations.`;
export async function parseNaturalLanguageToCampaignDSL(prompt, timezone = 'UTC') {
    const client = await getOpenAIClient();
    if (!client) {
        return {
            success: false,
            error: 'OpenAI API key not configured. Please configure it in Settings.',
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

Convert this campaign description to JSON:
"${prompt}"`;
        const response = await client.responses.parse({
            model: 'gpt-4o-mini',
            input: [
                { role: 'system', content: SYSTEM_PROMPT },
                { role: 'user', content: userPrompt },
            ],
            temperature: 0.1,
            max_output_tokens: 1000,
            text: {
                format: zodTextFormat(LLMResponseSchema, 'campaign_dsl'),
            },
        });
        if (response.status === 'incomplete') {
            const reason = response.incomplete_details?.reason;
            return {
                success: false,
                error: `Incomplete response from LLM: ${reason || 'unknown reason'}`,
            };
        }
        const outputItem = response.output?.[0];
        if (outputItem && 'content' in outputItem) {
            const content = outputItem.content?.[0];
            if (content && 'type' in content && content.type === 'refusal') {
                return {
                    success: false,
                    error: `LLM refused request: ${content.refusal}`,
                };
            }
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
        const isOnce = parsed.executionType === 'once';
        if (!parsed.name ||
            (!isOnce && !parsed.cron) ||
            !parsed.startAt ||
            !parsed.endAt ||
            !parsed.messageTemplate ||
            !parsed.channel ||
            !parsed.queryJson) {
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
        let conditions = null;
        if (parsed.conditionsJson) {
            try {
                conditions = JSON.parse(parsed.conditionsJson);
            }
            catch {
                return {
                    success: false,
                    error: 'DSL validation failed: invalid conditionsJson',
                    rawResponse,
                };
            }
        }
        let discount = null;
        if (parsed.discountJson) {
            try {
                discount = JSON.parse(parsed.discountJson);
            }
            catch {
                console.warn('Failed to parse discountJson:', parsed.discountJson);
            }
        }
        let gift = null;
        if (parsed.giftJson) {
            try {
                gift = JSON.parse(parsed.giftJson);
            }
            catch {
                console.warn('Failed to parse giftJson:', parsed.giftJson);
            }
        }
        const dsl = {
            name: parsed.name,
            description: parsed.description,
            cron: parsed.cron,
            startAt: parsed.startAt,
            endAt: parsed.endAt,
            query,
            messageTemplate: parsed.messageTemplate,
            channel: parsed.channel,
            conditions,
            executionType: parsed.executionType || 'recurring',
            discount,
            gift,
            includeRecommendations: parsed.includeRecommendations,
            recommendationAlgorithm: parsed.recommendationAlgorithm,
            recommendationLimit: parsed.recommendationLimit,
            excludePurchasedProducts: parsed.excludePurchasedProducts,
        };
        if (dsl.query) {
            dsl.query = processRelativeDates(dsl.query);
        }
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
export function validateCronExpression(cron) {
    const parts = cron.trim().split(/\s+/);
    if (parts.length !== 5)
        return false;
    const patterns = [
        /^(\*|[0-5]?\d)(-[0-5]?\d)?(\/\d+)?(,(\*|[0-5]?\d)(-[0-5]?\d)?(\/\d+)?)*$/,
        /^(\*|[01]?\d|2[0-3])(-([01]?\d|2[0-3]))?(\/\d+)?(,(\*|[01]?\d|2[0-3])(-([01]?\d|2[0-3]))?(\/\d+)?)*$/,
        /^(\*|[1-9]|[12]\d|3[01])(-([1-9]|[12]\d|3[01]))?(\/\d+)?(,(\*|[1-9]|[12]\d|3[01])(-([1-9]|[12]\d|3[01]))?(\/\d+)?)*$/,
        /^(\*|[1-9]|1[0-2])(-([1-9]|1[0-2]))?(\/\d+)?(,(\*|[1-9]|1[0-2])(-([1-9]|1[0-2]))?(\/\d+)?)*$/,
        /^(\*|[0-6])(-[0-6])?(\/\d+)?(,(\*|[0-6])(-[0-6])?(\/\d+)?)*$/,
    ];
    return parts.every((part, i) => patterns[i].test(part));
}
export function parseChannel(channel) {
    const channelMap = {
        email: 'email',
        sms: 'sms',
    };
    return channelMap[channel.toLowerCase()] || 'email';
}
const FlowNodeSchema = z.object({
    id: z.string(),
    type: z.enum(['send_email', 'send_sms', 'wait', 'conditional_split', 'exit_flow']),
    config: z.record(z.string(), z.unknown()),
});
const FlowEdgeSchema = z.object({
    id: z.string(),
    from: z.string(),
    to: z.string(),
    condition: z.string().optional(),
});
const FlowDefinitionSchema = z.object({
    nodes: z.array(FlowNodeSchema),
    edges: z.array(FlowEdgeSchema),
    startNodeId: z.string(),
});
export const FlowDSLSchema = z.object({
    name: z.string(),
    description: z.string().nullable(),
    triggerType: z.enum([
        'customer_joined_list',
        'abandoned_cart',
        'browse_abandonment',
        'order_placed',
        'order_fulfilled',
        'subscription_started',
        'subscription_cancelled',
        'custom_event',
        'form_submitted',
    ]),
    triggerConfig: z.record(z.string(), z.unknown()).nullable(),
    definition: FlowDefinitionSchema,
    allowReenrollment: z.boolean(),
    reenrollmentWaitDays: z.number().nullable(),
});
const FlowLLMResponseSchema = z.object({
    valid: z.boolean(),
    rejected: z.boolean().nullable(),
    reason: z.string().nullable(),
    category: z
        .enum(['gibberish', 'unrelated', 'unsafe', 'impossible', 'malicious', 'ambiguous'])
        .nullable(),
    useTemplate: z.boolean().nullable(),
    templateId: z.string().nullable(),
    name: z.string().nullable(),
    description: z.string().nullable(),
    triggerType: z
        .enum([
        'customer_joined_list',
        'abandoned_cart',
        'order_placed',
        'order_fulfilled',
        'subscription_started',
        'subscription_cancelled',
        'custom_event',
    ])
        .nullable(),
    triggerConfigJson: z.string().nullable(),
    definitionJson: z.string().nullable(),
    allowReenrollment: z.boolean().nullable(),
    reenrollmentWaitDays: z.number().nullable(),
});
function buildFlowSystemPrompt() {
    const templates = getFlowTemplates();
    const templateList = templates
        .map((t) => `- "${t.id}": ${t.name} - ${t.description} (trigger: ${t.triggerType})`)
        .join('\n');
    return `You are a flow DSL generator for a customer engagement platform.
Convert natural language descriptions into structured JSON flow definitions.
Flows are event-driven automation sequences that trigger based on customer actions.

AVAILABLE TEMPLATES:
When the user's request matches one of these preset templates, recommend using it:
${templateList}

RESPONSE FORMAT:
You must ALWAYS return valid JSON in ONE of these formats:

FORMAT 1 - USE TEMPLATE (when the request matches a preset template):
{
  "valid": true,
  "rejected": null,
  "reason": null,
  "category": null,
  "useTemplate": true,
  "templateId": "template-id-here",
  "name": null,
  "description": null,
  "triggerType": null,
  "triggerConfigJson": null,
  "definitionJson": null,
  "allowReenrollment": null,
  "reenrollmentWaitDays": null
}

FORMAT 2 - CUSTOM FLOW (when creating a new flow not matching templates):
{
  "valid": true,
  "rejected": null,
  "reason": null,
  "category": null,
  "useTemplate": false,
  "templateId": null,
  "name": "string (1-100 chars, descriptive name)",
  "description": "string or null",
  "triggerType": "abandoned_cart" | "order_placed" | "order_fulfilled" | "customer_joined_list" | "subscription_started" | "subscription_cancelled" | "custom_event",
  "triggerConfigJson": "JSON string of trigger config or null",
  "definitionJson": "JSON string of flow definition (must be valid JSON)",
  "allowReenrollment": false,
  "reenrollmentWaitDays": null
}

FORMAT 3 - REJECTED (when the prompt should be rejected):
{
  "valid": false,
  "rejected": true,
  "reason": "string explaining why this was rejected",
  "category": "gibberish" | "unrelated" | "unsafe" | "impossible" | "malicious" | "ambiguous",
  "useTemplate": null,
  "templateId": null,
  "name": null,
  "description": null,
  "triggerType": null,
  "triggerConfigJson": null,
  "definitionJson": null,
  "allowReenrollment": null,
  "reenrollmentWaitDays": null
}

FLOW TRIGGERS:
- abandoned_cart: When a customer abandons their shopping cart
- order_placed: When a customer completes a purchase
- order_fulfilled: When an order is shipped/fulfilled
- customer_joined_list: When a customer subscribes to a list/newsletter
- subscription_started: When a customer starts a subscription
- subscription_cancelled: When a customer cancels a subscription
- custom_event: For custom event types (specify eventType in triggerConfig)

FLOW DEFINITION STRUCTURE:
{
  "startNodeId": "first-node-id",
  "nodes": [
    {
      "id": "unique-node-id",
      "type": "send_email" | "send_sms" | "wait" | "conditional_split" | "exit_flow",
      "config": { ... node-specific config ... }
    }
  ],
  "edges": [
    {
      "id": "unique-edge-id",
      "from": "source-node-id",
      "to": "target-node-id",
      "condition": "optional condition label for conditional splits"
    }
  ]
}

NODE TYPES AND CONFIG:
1. send_email:
   {"subject": "Subject {{name}}", "body": "Message body...", "preheader": "optional"}

2. send_sms:
   {"body": "SMS message body {{name}}..."}

3. wait:
   {"delay": 86400, "unit": "days"} // delay is in seconds
   Common delays: 1 hour = 3600, 24 hours = 86400, 2 days = 172800, 7 days = 604800

4. conditional_split:
   {"conditions": [{"field": "customer.totalOrders", "operator": "gte", "value": 5, "label": "VIP"}]}

5. exit_flow:
   {"reason": "optional exit reason"}

MESSAGE TEMPLATE PLACEHOLDERS:
- {{name}} - Customer's full name
- {{email}} - Customer's email
- {{firstName}} - Customer's first name

TEMPLATE MATCHING:
- "abandoned cart" → recommend "abandoned-cart-recovery" template
- "welcome series" or "welcome email" → recommend "welcome-series" template
- "post-purchase" or "thank you after purchase" → recommend "post-purchase-followup" template
- "win-back" or "re-engage inactive" → recommend "win-back-campaign" template
- "shipping notification" or "order shipped" → recommend "order-fulfillment" template

Only output valid JSON, no explanations.`;
}
const nodeTypeLabels = {
    trigger: 'Trigger',
    send_email: 'Send Email',
    send_sms: 'Send SMS',
    wait: 'Wait',
    conditional_split: 'Conditional Split',
    exit_flow: 'Exit Flow',
};
const triggerTypeLabels = {
    customer_joined_list: 'Customer Joined List',
    abandoned_cart: 'Abandoned Cart',
    browse_abandonment: 'Browse Abandonment',
    order_placed: 'Order Placed',
    order_fulfilled: 'Order Fulfilled',
    subscription_started: 'Subscription Started',
    subscription_cancelled: 'Subscription Cancelled',
    custom_event: 'Custom Event',
};
function transformFlowDefinitionForFrontend(definition, triggerType, triggerConfig) {
    const Y_SPACING = 120;
    const X_CENTER = 250;
    const triggerNodeId = 'trigger-node';
    const triggerNode = {
        id: triggerNodeId,
        type: 'trigger',
        position: { x: X_CENTER, y: 50 },
        data: {
            label: triggerTypeLabels[triggerType] || 'Trigger',
            config: {
                triggerType,
                ...triggerConfig,
            },
        },
    };
    const transformedNodes = definition.nodes.map((node, index) => {
        const nodeAny = node;
        const existingConfig = nodeAny.config;
        const existingData = nodeAny.data;
        const config = existingData?.config || existingConfig || {};
        const label = existingData?.label || nodeTypeLabels[node.type] || node.type;
        const position = node.position || {
            x: X_CENTER,
            y: (index + 1) * Y_SPACING + 50,
        };
        return {
            id: node.id,
            type: node.type,
            position,
            data: {
                label,
                config,
            },
        };
    });
    const allNodes = [triggerNode, ...transformedNodes];
    const transformedEdges = definition.edges.map((edge, index) => {
        const edgeAny = edge;
        const source = edgeAny.source || edgeAny.from || '';
        const target = edgeAny.target || edgeAny.to || '';
        const condition = edgeAny.condition;
        return {
            id: edge.id || `edge-${index}`,
            source,
            target,
            ...(condition && { label: condition, data: { condition } }),
        };
    });
    const triggerEdge = {
        id: 'trigger-edge',
        source: triggerNodeId,
        target: definition.startNodeId,
    };
    const allEdges = [triggerEdge, ...transformedEdges];
    return {
        nodes: allNodes,
        edges: allEdges,
        startNodeId: triggerNodeId,
    };
}
export async function parseNaturalLanguageToFlowDSL(prompt) {
    const client = await getOpenAIClient();
    if (!client) {
        return {
            success: false,
            error: 'OpenAI API key not configured. Please configure it in Settings.',
        };
    }
    try {
        const userPrompt = `Convert this flow description to JSON:
"${prompt}"`;
        const response = await client.responses.parse({
            model: 'gpt-4o-mini',
            input: [
                { role: 'system', content: buildFlowSystemPrompt() },
                { role: 'user', content: userPrompt },
            ],
            temperature: 0.1,
            max_output_tokens: 2000,
            text: {
                format: zodTextFormat(FlowLLMResponseSchema, 'flow_dsl'),
            },
        });
        if (response.status === 'incomplete') {
            const reason = response.incomplete_details?.reason;
            return {
                success: false,
                error: `Incomplete response from LLM: ${reason || 'unknown reason'}`,
            };
        }
        const outputItem = response.output?.[0];
        if (outputItem && 'content' in outputItem) {
            const content = outputItem.content?.[0];
            if (content && 'type' in content && content.type === 'refusal') {
                return {
                    success: false,
                    error: `LLM refused request: ${content.refusal}`,
                };
            }
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
        if (parsed.useTemplate === true && parsed.templateId) {
            return {
                success: true,
                useTemplate: true,
                templateId: parsed.templateId,
                rawResponse,
            };
        }
        if (!parsed.name || !parsed.triggerType || !parsed.definitionJson) {
            return {
                success: false,
                error: 'Flow DSL validation failed: missing required fields',
                rawResponse,
            };
        }
        let definition;
        try {
            definition = JSON.parse(parsed.definitionJson);
        }
        catch {
            return {
                success: false,
                error: 'Flow DSL validation failed: invalid definitionJson',
                rawResponse,
            };
        }
        let triggerConfig = null;
        if (parsed.triggerConfigJson) {
            try {
                triggerConfig = JSON.parse(parsed.triggerConfigJson);
            }
            catch {
                console.warn('Failed to parse triggerConfigJson');
            }
        }
        const transformedDefinition = transformFlowDefinitionForFrontend(definition, parsed.triggerType, triggerConfig);
        const dsl = {
            name: parsed.name,
            description: parsed.description,
            triggerType: parsed.triggerType,
            triggerConfig,
            definition: transformedDefinition,
            allowReenrollment: parsed.allowReenrollment || false,
            reenrollmentWaitDays: parsed.reenrollmentWaitDays,
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
const SubjectLineResponseSchema = z.object({
    suggestions: z.array(z.object({
        subject: z.string(),
        tone: z.enum(['urgent', 'friendly', 'curiosity', 'professional', 'playful', 'exclusive']),
        reasoning: z.string(),
    })),
});
const SUBJECT_LINE_SYSTEM_PROMPT = `You are an expert email marketing copywriter specializing in subject lines.
Generate compelling subject lines that drive high open rates.

RULES:
1. Keep subject lines under 50 characters when possible (mobile-friendly)
2. Avoid spam trigger words (FREE, ACT NOW, LIMITED TIME in all caps)
3. Use personalization with {{name}} or {{firstName}} when appropriate
4. Each subject line should have a distinct tone/approach
5. Consider the campaign content and target audience
6. If there's a discount or offer, incorporate it naturally

TONES:
- urgent: Creates time pressure without being spammy (e.g., "Last chance", "Ending soon")
- friendly: Warm, conversational, personal (e.g., "Hey {{firstName}}, check this out")
- curiosity: Intriguing, makes reader want to know more (e.g., "You won't believe...")
- professional: Business-like, straightforward value proposition
- playful: Fun, uses wordplay, emojis (sparingly), or humor
- exclusive: Makes reader feel special (e.g., "Just for you", "VIP access")

OUTPUT FORMAT:
Return exactly 5 subject line suggestions with different tones.
Each suggestion must include:
- subject: The subject line text (under 60 chars)
- tone: One of the tone types
- reasoning: Brief explanation of why this works (1 sentence)`;
export async function generateSubjectLines(campaignName, campaignDescription, messageBody, discount, gift) {
    const client = await getOpenAIClient();
    if (!client) {
        return {
            success: false,
            error: 'OpenAI API key not configured. Please configure it in Settings.',
        };
    }
    try {
        let context = `Campaign Name: ${campaignName}\n`;
        if (campaignDescription) {
            context += `Campaign Description: ${campaignDescription}\n`;
        }
        context += `Message Body: ${messageBody}\n`;
        if (discount) {
            context += `Discount: ${discount.formattedValue || `${discount.type} - ${discount.value}`}\n`;
        }
        if (gift) {
            context += `Gift: ${gift.value || gift.type}\n`;
        }
        const userPrompt = `Generate 5 compelling subject line variations for this email campaign:

${context}

Remember to:
- Include at least one with personalization ({{name}} or {{firstName}})
- Make each subject line unique in tone and approach
- Keep them concise and mobile-friendly`;
        const response = await client.responses.parse({
            model: 'gpt-4o-mini',
            input: [
                { role: 'system', content: SUBJECT_LINE_SYSTEM_PROMPT },
                { role: 'user', content: userPrompt },
            ],
            temperature: 0.8,
            max_output_tokens: 1000,
            text: {
                format: zodTextFormat(SubjectLineResponseSchema, 'subject_lines'),
            },
        });
        if (response.status === 'incomplete') {
            const reason = response.incomplete_details?.reason;
            return {
                success: false,
                error: `Incomplete response from LLM: ${reason || 'unknown reason'}`,
            };
        }
        const parsed = response.output_parsed;
        if (!parsed || !parsed.suggestions || parsed.suggestions.length === 0) {
            return {
                success: false,
                error: 'No suggestions generated',
            };
        }
        return {
            success: true,
            suggestions: parsed.suggestions,
        };
    }
    catch (err) {
        const errorMessage = err instanceof Error ? err.message : 'Unknown error';
        return {
            success: false,
            error: `Subject line generation failed: ${errorMessage}`,
        };
    }
}
