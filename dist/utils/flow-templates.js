const NODE_VERTICAL_SPACING = 120;
const NODE_START_X = 250;
const NODE_START_Y = 50;
const abandonedCartTemplate = {
    id: 'abandoned-cart-recovery',
    name: 'Abandoned Cart Recovery',
    description: 'Recover lost sales by sending timely reminders to customers who left items in their cart. Includes escalating messaging with optional discount incentive.',
    category: 'reactivation',
    triggerType: 'abandoned_cart',
    triggerDescription: 'When a customer abandons their shopping cart',
    estimatedDuration: '3 days',
    previewSteps: [
        'Cart abandoned trigger',
        'Wait 1 hour',
        'Send reminder email',
        'Wait 24 hours',
        'Send urgency email',
        'Wait 48 hours',
        'Send final email with discount',
    ],
    definition: {
        startNodeId: 'trigger-1',
        nodes: [
            {
                id: 'trigger-1',
                type: 'trigger',
                position: { x: NODE_START_X, y: NODE_START_Y },
                data: {
                    label: 'Cart Abandoned',
                    config: { triggerType: 'abandoned_cart' },
                },
            },
            {
                id: 'wait-1',
                type: 'wait',
                position: { x: NODE_START_X, y: NODE_START_Y + NODE_VERTICAL_SPACING },
                data: {
                    label: 'Wait 1 hour',
                    config: { delay: 3600, unit: 'hours' },
                },
            },
            {
                id: 'email-1',
                type: 'send_email',
                position: { x: NODE_START_X, y: NODE_START_Y + NODE_VERTICAL_SPACING * 2 },
                data: {
                    label: 'Reminder Email',
                    config: {
                        subject: '{{name}}, you left something behind!',
                        body: "Hi {{name}},\n\nWe noticed you left some items in your cart. Don't worry, we saved them for you!\n\nReady to complete your purchase? Click here to pick up where you left off.\n\nBest,\nThe Team",
                        preheader: 'Your cart is waiting for you',
                    },
                },
            },
            {
                id: 'wait-2',
                type: 'wait',
                position: { x: NODE_START_X, y: NODE_START_Y + NODE_VERTICAL_SPACING * 3 },
                data: {
                    label: 'Wait 24 hours',
                    config: { delay: 86400, unit: 'hours' },
                },
            },
            {
                id: 'email-2',
                type: 'send_email',
                position: { x: NODE_START_X, y: NODE_START_Y + NODE_VERTICAL_SPACING * 4 },
                data: {
                    label: 'Urgency Email',
                    config: {
                        subject: 'Your cart items are selling fast, {{name}}!',
                        body: "Hi {{name}},\n\nJust a friendly reminder that the items in your cart are popular and may sell out soon.\n\nComplete your order now to make sure you don't miss out!\n\nBest,\nThe Team",
                        preheader: "Don't miss out on your items",
                    },
                },
            },
            {
                id: 'wait-3',
                type: 'wait',
                position: { x: NODE_START_X, y: NODE_START_Y + NODE_VERTICAL_SPACING * 5 },
                data: {
                    label: 'Wait 48 hours',
                    config: { delay: 172800, unit: 'hours' },
                },
            },
            {
                id: 'email-3',
                type: 'send_email',
                position: { x: NODE_START_X, y: NODE_START_Y + NODE_VERTICAL_SPACING * 6 },
                data: {
                    label: 'Final Email + Discount',
                    config: {
                        subject: 'Final reminder: Complete your order, {{name}}!',
                        body: 'Hi {{name}},\n\nThis is your last chance! The items in your cart are still waiting for you.\n\nAs a special thank you, use code COMEBACK10 for 10% off your order.\n\nBest,\nThe Team',
                        preheader: 'Last chance + special offer inside',
                    },
                },
            },
            {
                id: 'exit-1',
                type: 'exit_flow',
                position: { x: NODE_START_X, y: NODE_START_Y + NODE_VERTICAL_SPACING * 7 },
                data: {
                    label: 'Exit Flow',
                    config: { reason: 'Flow completed' },
                },
            },
        ],
        edges: [
            { id: 'e0', source: 'trigger-1', target: 'wait-1' },
            { id: 'e1', source: 'wait-1', target: 'email-1' },
            { id: 'e2', source: 'email-1', target: 'wait-2' },
            { id: 'e3', source: 'wait-2', target: 'email-2' },
            { id: 'e4', source: 'email-2', target: 'wait-3' },
            { id: 'e5', source: 'wait-3', target: 'email-3' },
            { id: 'e6', source: 'email-3', target: 'exit-1' },
        ],
    },
};
const welcomeSeriesTemplate = {
    id: 'welcome-series',
    name: 'Welcome Series',
    description: 'Welcome new subscribers with a warm introduction to your brand. Build trust and encourage their first purchase with personalized messaging.',
    category: 'acquisition',
    triggerType: 'customer_joined_list',
    triggerDescription: 'When a customer subscribes to your list or newsletter',
    estimatedDuration: '5 days',
    previewSteps: [
        'Customer joined list trigger',
        'Send welcome email immediately',
        'Wait 2 days',
        'Send brand story email',
        'Wait 3 days',
        'Send first purchase incentive',
    ],
    definition: {
        startNodeId: 'trigger-1',
        nodes: [
            {
                id: 'trigger-1',
                type: 'trigger',
                position: { x: NODE_START_X, y: NODE_START_Y },
                data: {
                    label: 'Customer Joined List',
                    config: { triggerType: 'customer_joined_list' },
                },
            },
            {
                id: 'email-1',
                type: 'send_email',
                position: { x: NODE_START_X, y: NODE_START_Y + NODE_VERTICAL_SPACING },
                data: {
                    label: 'Welcome Email',
                    config: {
                        subject: 'Welcome to the family, {{name}}!',
                        body: "Hi {{name}},\n\nWelcome! We're thrilled to have you join us.\n\nAs a thank you for signing up, here's what you can expect:\n- Exclusive offers and early access to new products\n- Helpful tips and inspiration\n- Special member-only perks\n\nStay tuned for more!\n\nBest,\nThe Team",
                        preheader: "You're in! Here's what to expect",
                    },
                },
            },
            {
                id: 'wait-1',
                type: 'wait',
                position: { x: NODE_START_X, y: NODE_START_Y + NODE_VERTICAL_SPACING * 2 },
                data: {
                    label: 'Wait 2 days',
                    config: { delay: 172800, unit: 'days' },
                },
            },
            {
                id: 'email-2',
                type: 'send_email',
                position: { x: NODE_START_X, y: NODE_START_Y + NODE_VERTICAL_SPACING * 3 },
                data: {
                    label: 'Brand Story Email',
                    config: {
                        subject: 'Our story, {{name}}',
                        body: "Hi {{name}},\n\nWe wanted to share a bit about who we are and why we do what we do.\n\n[Share your brand story here - your mission, values, and what makes you unique]\n\nWe're so glad you're here on this journey with us.\n\nBest,\nThe Team",
                        preheader: 'Learn more about us',
                    },
                },
            },
            {
                id: 'wait-2',
                type: 'wait',
                position: { x: NODE_START_X, y: NODE_START_Y + NODE_VERTICAL_SPACING * 4 },
                data: {
                    label: 'Wait 3 days',
                    config: { delay: 259200, unit: 'days' },
                },
            },
            {
                id: 'email-3',
                type: 'send_email',
                position: { x: NODE_START_X, y: NODE_START_Y + NODE_VERTICAL_SPACING * 5 },
                data: {
                    label: 'First Purchase Incentive',
                    config: {
                        subject: 'A special gift for you, {{name}}!',
                        body: "Hi {{name}},\n\nReady to make your first purchase? We've got something special for you.\n\nUse code WELCOME15 for 15% off your first order!\n\nThis offer expires in 7 days, so don't wait too long.\n\nBest,\nThe Team",
                        preheader: 'Your exclusive welcome offer inside',
                    },
                },
            },
            {
                id: 'exit-1',
                type: 'exit_flow',
                position: { x: NODE_START_X, y: NODE_START_Y + NODE_VERTICAL_SPACING * 6 },
                data: {
                    label: 'Exit Flow',
                    config: { reason: 'Welcome series completed' },
                },
            },
        ],
        edges: [
            { id: 'e0', source: 'trigger-1', target: 'email-1' },
            { id: 'e1', source: 'email-1', target: 'wait-1' },
            { id: 'e2', source: 'wait-1', target: 'email-2' },
            { id: 'e3', source: 'email-2', target: 'wait-2' },
            { id: 'e4', source: 'wait-2', target: 'email-3' },
            { id: 'e5', source: 'email-3', target: 'exit-1' },
        ],
    },
};
const postPurchaseTemplate = {
    id: 'post-purchase-followup',
    name: 'Post-Purchase Follow-Up',
    description: 'Thank customers after their purchase and build loyalty. Request reviews and encourage repeat purchases.',
    category: 'retention',
    triggerType: 'order_placed',
    triggerDescription: 'When a customer completes a purchase',
    estimatedDuration: '14 days',
    previewSteps: [
        'Order placed trigger',
        'Send thank you email immediately',
        'Wait 7 days (delivery time)',
        'Send review request email',
        'Wait 7 days',
        'Send cross-sell recommendation',
    ],
    definition: {
        startNodeId: 'trigger-1',
        nodes: [
            {
                id: 'trigger-1',
                type: 'trigger',
                position: { x: NODE_START_X, y: NODE_START_Y },
                data: {
                    label: 'Order Placed',
                    config: { triggerType: 'order_placed' },
                },
            },
            {
                id: 'email-1',
                type: 'send_email',
                position: { x: NODE_START_X, y: NODE_START_Y + NODE_VERTICAL_SPACING },
                data: {
                    label: 'Thank You Email',
                    config: {
                        subject: 'Thank you for your order, {{name}}!',
                        body: "Hi {{name}},\n\nThank you so much for your order! We're preparing it with care and will have it on its way to you soon.\n\nYou'll receive tracking information once your order ships.\n\nIf you have any questions, don't hesitate to reach out.\n\nBest,\nThe Team",
                        preheader: "We're getting your order ready",
                    },
                },
            },
            {
                id: 'wait-1',
                type: 'wait',
                position: { x: NODE_START_X, y: NODE_START_Y + NODE_VERTICAL_SPACING * 2 },
                data: {
                    label: 'Wait 7 days',
                    config: { delay: 604800, unit: 'days' },
                },
            },
            {
                id: 'email-2',
                type: 'send_email',
                position: { x: NODE_START_X, y: NODE_START_Y + NODE_VERTICAL_SPACING * 3 },
                data: {
                    label: 'Review Request',
                    config: {
                        subject: 'How are you enjoying your purchase, {{name}}?',
                        body: "Hi {{name}},\n\nWe hope you're loving your recent purchase!\n\nWe'd love to hear what you think. Your feedback helps us improve and helps other customers make informed decisions.\n\nWould you take a moment to leave a review?\n\n[Add review link here]\n\nThank you!\n\nBest,\nThe Team",
                        preheader: 'Share your thoughts with us',
                    },
                },
            },
            {
                id: 'wait-2',
                type: 'wait',
                position: { x: NODE_START_X, y: NODE_START_Y + NODE_VERTICAL_SPACING * 4 },
                data: {
                    label: 'Wait 7 days',
                    config: { delay: 604800, unit: 'days' },
                },
            },
            {
                id: 'email-3',
                type: 'send_email',
                position: { x: NODE_START_X, y: NODE_START_Y + NODE_VERTICAL_SPACING * 5 },
                data: {
                    label: 'Cross-sell Recommendation',
                    config: {
                        subject: '{{name}}, you might also like these',
                        body: 'Hi {{name}},\n\nBased on your recent purchase, we thought you might be interested in these:\n\n[Add product recommendations here]\n\nAs a valued customer, use code THANKYOU10 for 10% off your next order.\n\nBest,\nThe Team',
                        preheader: 'Curated picks just for you',
                    },
                },
            },
            {
                id: 'exit-1',
                type: 'exit_flow',
                position: { x: NODE_START_X, y: NODE_START_Y + NODE_VERTICAL_SPACING * 6 },
                data: {
                    label: 'Exit Flow',
                    config: { reason: 'Post-purchase sequence completed' },
                },
            },
        ],
        edges: [
            { id: 'e0', source: 'trigger-1', target: 'email-1' },
            { id: 'e1', source: 'email-1', target: 'wait-1' },
            { id: 'e2', source: 'wait-1', target: 'email-2' },
            { id: 'e3', source: 'email-2', target: 'wait-2' },
            { id: 'e4', source: 'wait-2', target: 'email-3' },
            { id: 'e5', source: 'email-3', target: 'exit-1' },
        ],
    },
};
const winBackTemplate = {
    id: 'win-back-campaign',
    name: 'Win-Back Campaign',
    description: 'Re-engage customers who have become inactive. Remind them why they loved your brand and incentivize their return.',
    category: 'reactivation',
    triggerType: 'custom_event',
    triggerDescription: 'When a customer is identified as inactive (customizable)',
    estimatedDuration: '10 days',
    previewSteps: [
        'Inactive customer trigger',
        'Send "We miss you" email',
        'Wait 5 days',
        'Send exclusive offer email',
        'Wait 5 days',
        'Send final win-back email',
    ],
    definition: {
        startNodeId: 'trigger-1',
        nodes: [
            {
                id: 'trigger-1',
                type: 'trigger',
                position: { x: NODE_START_X, y: NODE_START_Y },
                data: {
                    label: 'Customer Inactive',
                    config: { triggerType: 'custom_event', eventType: 'customer_inactive' },
                },
            },
            {
                id: 'email-1',
                type: 'send_email',
                position: { x: NODE_START_X, y: NODE_START_Y + NODE_VERTICAL_SPACING },
                data: {
                    label: 'We Miss You Email',
                    config: {
                        subject: 'We miss you, {{name}}!',
                        body: "Hi {{name}},\n\nIt's been a while since we've seen you, and we wanted to check in.\n\nA lot has happened since your last visit - new products, exciting updates, and more!\n\nCome back and see what's new.\n\nBest,\nThe Team",
                        preheader: "It's been too long!",
                    },
                },
            },
            {
                id: 'wait-1',
                type: 'wait',
                position: { x: NODE_START_X, y: NODE_START_Y + NODE_VERTICAL_SPACING * 2 },
                data: {
                    label: 'Wait 5 days',
                    config: { delay: 432000, unit: 'days' },
                },
            },
            {
                id: 'email-2',
                type: 'send_email',
                position: { x: NODE_START_X, y: NODE_START_Y + NODE_VERTICAL_SPACING * 3 },
                data: {
                    label: 'Exclusive Offer Email',
                    config: {
                        subject: "{{name}}, here's something special just for you",
                        body: "Hi {{name}},\n\nWe really want you back, so we're offering you an exclusive deal.\n\nUse code COMEBACK20 for 20% off your next order!\n\nThis offer is just for you and expires in 7 days.\n\nBest,\nThe Team",
                        preheader: 'Exclusive offer inside',
                    },
                },
            },
            {
                id: 'wait-2',
                type: 'wait',
                position: { x: NODE_START_X, y: NODE_START_Y + NODE_VERTICAL_SPACING * 4 },
                data: {
                    label: 'Wait 5 days',
                    config: { delay: 432000, unit: 'days' },
                },
            },
            {
                id: 'email-3',
                type: 'send_email',
                position: { x: NODE_START_X, y: NODE_START_Y + NODE_VERTICAL_SPACING * 5 },
                data: {
                    label: 'Final Win-back Email',
                    config: {
                        subject: 'Last chance, {{name}} - your offer expires soon!',
                        body: "Hi {{name}},\n\nYour exclusive 20% off offer is about to expire!\n\nDon't miss out - use code COMEBACK20 before it's gone.\n\nWe hope to see you soon!\n\nBest,\nThe Team",
                        preheader: 'Your offer expires soon',
                    },
                },
            },
            {
                id: 'exit-1',
                type: 'exit_flow',
                position: { x: NODE_START_X, y: NODE_START_Y + NODE_VERTICAL_SPACING * 6 },
                data: {
                    label: 'Exit Flow',
                    config: { reason: 'Win-back campaign completed' },
                },
            },
        ],
        edges: [
            { id: 'e0', source: 'trigger-1', target: 'email-1' },
            { id: 'e1', source: 'email-1', target: 'wait-1' },
            { id: 'e2', source: 'wait-1', target: 'email-2' },
            { id: 'e3', source: 'email-2', target: 'wait-2' },
            { id: 'e4', source: 'wait-2', target: 'email-3' },
            { id: 'e5', source: 'email-3', target: 'exit-1' },
        ],
    },
};
const orderFulfillmentTemplate = {
    id: 'order-fulfillment',
    name: 'Order Fulfillment Notification',
    description: 'Keep customers informed when their order ships. Includes delivery expectations and support information.',
    category: 'engagement',
    triggerType: 'order_fulfilled',
    triggerDescription: 'When an order is shipped or fulfilled',
    estimatedDuration: '1 day',
    previewSteps: [
        'Order fulfilled trigger',
        'Send shipping notification email immediately',
        'Wait 24 hours',
        'Send delivery reminder',
    ],
    definition: {
        startNodeId: 'trigger-1',
        nodes: [
            {
                id: 'trigger-1',
                type: 'trigger',
                position: { x: NODE_START_X, y: NODE_START_Y },
                data: {
                    label: 'Order Fulfilled',
                    config: { triggerType: 'order_fulfilled' },
                },
            },
            {
                id: 'email-1',
                type: 'send_email',
                position: { x: NODE_START_X, y: NODE_START_Y + NODE_VERTICAL_SPACING },
                data: {
                    label: 'Shipping Notification',
                    config: {
                        subject: '{{name}}, your order is on its way!',
                        body: "Hi {{name}},\n\nGreat news! Your order has shipped and is on its way to you.\n\nYou can track your package using the link below:\n[Add tracking link here]\n\nExpected delivery: [Add estimated date]\n\nIf you have any questions, we're here to help.\n\nBest,\nThe Team",
                        preheader: 'Your order is on its way',
                    },
                },
            },
            {
                id: 'wait-1',
                type: 'wait',
                position: { x: NODE_START_X, y: NODE_START_Y + NODE_VERTICAL_SPACING * 2 },
                data: {
                    label: 'Wait 24 hours',
                    config: { delay: 86400, unit: 'hours' },
                },
            },
            {
                id: 'email-2',
                type: 'send_email',
                position: { x: NODE_START_X, y: NODE_START_Y + NODE_VERTICAL_SPACING * 3 },
                data: {
                    label: 'Delivery Reminder',
                    config: {
                        subject: 'Your package should arrive soon, {{name}}!',
                        body: 'Hi {{name}},\n\nJust a quick update - your package should be arriving soon!\n\nKeep an eye out for it, and let us know if you have any questions.\n\nBest,\nThe Team',
                        preheader: 'Almost there!',
                    },
                },
            },
            {
                id: 'exit-1',
                type: 'exit_flow',
                position: { x: NODE_START_X, y: NODE_START_Y + NODE_VERTICAL_SPACING * 4 },
                data: {
                    label: 'Exit Flow',
                    config: { reason: 'Fulfillment notification completed' },
                },
            },
        ],
        edges: [
            { id: 'e0', source: 'trigger-1', target: 'email-1' },
            { id: 'e1', source: 'email-1', target: 'wait-1' },
            { id: 'e2', source: 'wait-1', target: 'email-2' },
            { id: 'e3', source: 'email-2', target: 'exit-1' },
        ],
    },
};
const browseAbandonmentTemplate = {
    id: 'browse-abandonment-recovery',
    name: 'Browse Abandonment Recovery',
    description: 'Recover potential sales by reminding customers about products they viewed. Includes product details and personalized messaging.',
    category: 'reactivation',
    triggerType: 'browse_abandonment',
    triggerDescription: "When a customer views a product but doesn't add it to cart",
    estimatedDuration: '48 hours',
    previewSteps: [
        'Browse abandonment trigger',
        'Wait 2 hours',
        'Send product reminder email',
        'Wait 24 hours',
        'Send follow-up with incentive',
    ],
    definition: {
        startNodeId: 'trigger-1',
        nodes: [
            {
                id: 'trigger-1',
                type: 'trigger',
                position: { x: NODE_START_X, y: NODE_START_Y },
                data: {
                    label: 'Browse Abandoned',
                    config: { triggerType: 'browse_abandonment' },
                },
            },
            {
                id: 'wait-1',
                type: 'wait',
                position: { x: NODE_START_X, y: NODE_START_Y + NODE_VERTICAL_SPACING },
                data: {
                    label: 'Wait 2 hours',
                    config: { delay: 7200, unit: 'hours' },
                },
            },
            {
                id: 'email-1',
                type: 'send_email',
                position: { x: NODE_START_X, y: NODE_START_Y + NODE_VERTICAL_SPACING * 2 },
                data: {
                    label: 'Product Reminder',
                    config: {
                        subject: '{{name}}, still thinking about {{productName}}?',
                        body: `Hi {{name}},

We noticed you were checking out {{productName}} earlier.

{{productName}}
{{price}} {{currency}}

Ready to make it yours? Click here to view the product:
{{productUrl}}

If you have any questions, we're here to help!

Best,
The Team`,
                        preheader: 'Your viewed product is waiting for you',
                    },
                },
            },
            {
                id: 'wait-2',
                type: 'wait',
                position: { x: NODE_START_X, y: NODE_START_Y + NODE_VERTICAL_SPACING * 3 },
                data: {
                    label: 'Wait 24 hours',
                    config: { delay: 86400, unit: 'hours' },
                },
            },
            {
                id: 'email-2',
                type: 'send_email',
                position: { x: NODE_START_X, y: NODE_START_Y + NODE_VERTICAL_SPACING * 4 },
                data: {
                    label: 'Follow-up + Incentive',
                    config: {
                        subject: 'Last chance: {{productName}} + special offer!',
                        body: `Hi {{name}},

We saved {{productName}} for you, and we want to make it easier for you to decide.

Use code BROWSE10 for 10% off your order!

{{productName}}
{{price}} {{currency}}

This offer expires in 24 hours, so don't wait!

Best,
The Team`,
                        preheader: 'Special offer on your viewed product',
                    },
                },
            },
            {
                id: 'exit-1',
                type: 'exit_flow',
                position: { x: NODE_START_X, y: NODE_START_Y + NODE_VERTICAL_SPACING * 5 },
                data: {
                    label: 'Exit Flow',
                    config: { reason: 'Browse abandonment flow completed' },
                },
            },
        ],
        edges: [
            { id: 'e0', source: 'trigger-1', target: 'wait-1' },
            { id: 'e1', source: 'wait-1', target: 'email-1' },
            { id: 'e2', source: 'email-1', target: 'wait-2' },
            { id: 'e3', source: 'wait-2', target: 'email-2' },
            { id: 'e4', source: 'email-2', target: 'exit-1' },
        ],
    },
};
const birthdayCampaignTemplate = {
    id: 'birthday-campaign',
    name: 'Birthday Campaign',
    description: 'Celebrate your customers on their birthday with personalized wishes and an exclusive discount offer.',
    category: 'retention',
    triggerType: 'custom_event',
    triggerDescription: "When it's a customer's birthday",
    estimatedDuration: '7 days',
    previewSteps: [
        'Birthday trigger',
        'Send birthday email with discount',
        'Wait 5 days',
        'Send reminder if unused',
    ],
    definition: {
        startNodeId: 'trigger-1',
        nodes: [
            {
                id: 'trigger-1',
                type: 'trigger',
                position: { x: NODE_START_X, y: NODE_START_Y },
                data: {
                    label: 'Birthday Event',
                    config: { triggerType: 'custom_event', eventType: 'customer_birthday' },
                },
            },
            {
                id: 'email-1',
                type: 'send_email',
                position: { x: NODE_START_X, y: NODE_START_Y + NODE_VERTICAL_SPACING },
                data: {
                    label: 'Birthday Email',
                    config: {
                        subject: '🎂 Happy Birthday, {{name}}! A gift for you inside',
                        body: 'Hi {{name}},\n\n🎉 Happy Birthday! 🎉\n\nWe hope you have an amazing day filled with joy!\n\nAs our gift to you, enjoy 25% off your next order with code: BIRTHDAY25\n\nThis offer is valid for the next 7 days.\n\nCheers,\nThe Team',
                        preheader: 'Your birthday gift is waiting',
                    },
                },
            },
            {
                id: 'wait-1',
                type: 'wait',
                position: { x: NODE_START_X, y: NODE_START_Y + NODE_VERTICAL_SPACING * 2 },
                data: {
                    label: 'Wait 5 days',
                    config: { delay: 432000, unit: 'days' },
                },
            },
            {
                id: 'email-2',
                type: 'send_email',
                position: { x: NODE_START_X, y: NODE_START_Y + NODE_VERTICAL_SPACING * 3 },
                data: {
                    label: 'Reminder Email',
                    config: {
                        subject: "{{name}}, don't forget your birthday gift!",
                        body: "Hi {{name}},\n\nJust a reminder that your birthday discount is expiring soon!\n\nUse code BIRTHDAY25 for 25% off before it's gone.\n\nTreat yourself - you deserve it! 🎁\n\nBest,\nThe Team",
                        preheader: 'Your birthday offer expires soon',
                    },
                },
            },
            {
                id: 'exit-1',
                type: 'exit_flow',
                position: { x: NODE_START_X, y: NODE_START_Y + NODE_VERTICAL_SPACING * 4 },
                data: {
                    label: 'Exit Flow',
                    config: { reason: 'Birthday campaign completed' },
                },
            },
        ],
        edges: [
            { id: 'e0', source: 'trigger-1', target: 'email-1' },
            { id: 'e1', source: 'email-1', target: 'wait-1' },
            { id: 'e2', source: 'wait-1', target: 'email-2' },
            { id: 'e3', source: 'email-2', target: 'exit-1' },
        ],
    },
};
const reviewRequestTemplate = {
    id: 'review-request',
    name: 'Review Request',
    description: 'Request product reviews from customers after they receive their order. Includes follow-up for non-responders.',
    category: 'engagement',
    triggerType: 'order_fulfilled',
    triggerDescription: 'When an order is delivered',
    estimatedDuration: '14 days',
    previewSteps: [
        'Order fulfilled trigger',
        'Wait 7 days (delivery buffer)',
        'Send review request',
        'Wait 7 days',
        'Send follow-up reminder',
    ],
    definition: {
        startNodeId: 'trigger-1',
        nodes: [
            {
                id: 'trigger-1',
                type: 'trigger',
                position: { x: NODE_START_X, y: NODE_START_Y },
                data: {
                    label: 'Order Delivered',
                    config: { triggerType: 'order_fulfilled' },
                },
            },
            {
                id: 'wait-1',
                type: 'wait',
                position: { x: NODE_START_X, y: NODE_START_Y + NODE_VERTICAL_SPACING },
                data: {
                    label: 'Wait 7 days',
                    config: { delay: 604800, unit: 'days' },
                },
            },
            {
                id: 'email-1',
                type: 'send_email',
                position: { x: NODE_START_X, y: NODE_START_Y + NODE_VERTICAL_SPACING * 2 },
                data: {
                    label: 'Review Request',
                    config: {
                        subject: '{{name}}, how do you like your purchase?',
                        body: "Hi {{name}},\n\nWe hope you're enjoying your recent purchase!\n\nYour feedback means the world to us and helps other customers make informed decisions.\n\nWould you take a minute to share your thoughts?\n\n⭐⭐⭐⭐⭐\n\n[Leave a Review]\n\nAs a thank you, reviewers get 10% off their next order!\n\nBest,\nThe Team",
                        preheader: 'Share your experience and get 10% off',
                    },
                },
            },
            {
                id: 'wait-2',
                type: 'wait',
                position: { x: NODE_START_X, y: NODE_START_Y + NODE_VERTICAL_SPACING * 3 },
                data: {
                    label: 'Wait 7 days',
                    config: { delay: 604800, unit: 'days' },
                },
            },
            {
                id: 'email-2',
                type: 'send_email',
                position: { x: NODE_START_X, y: NODE_START_Y + NODE_VERTICAL_SPACING * 4 },
                data: {
                    label: 'Review Reminder',
                    config: {
                        subject: "Quick favor, {{name}}? We'd love your feedback",
                        body: "Hi {{name}},\n\nWe noticed you haven't had a chance to leave a review yet.\n\nIt only takes 30 seconds and helps us improve:\n\n[Leave a Review]\n\nYour 10% discount code is still waiting!\n\nThanks for being a valued customer.\n\nBest,\nThe Team",
                        preheader: 'Your discount is waiting',
                    },
                },
            },
            {
                id: 'exit-1',
                type: 'exit_flow',
                position: { x: NODE_START_X, y: NODE_START_Y + NODE_VERTICAL_SPACING * 5 },
                data: {
                    label: 'Exit Flow',
                    config: { reason: 'Review request completed' },
                },
            },
        ],
        edges: [
            { id: 'e0', source: 'trigger-1', target: 'wait-1' },
            { id: 'e1', source: 'wait-1', target: 'email-1' },
            { id: 'e2', source: 'email-1', target: 'wait-2' },
            { id: 'e3', source: 'wait-2', target: 'email-2' },
            { id: 'e4', source: 'email-2', target: 'exit-1' },
        ],
    },
};
const backInStockTemplate = {
    id: 'back-in-stock',
    name: 'Back in Stock Alert',
    description: 'Notify customers when a product they wanted is back in stock. Creates urgency with limited stock messaging.',
    category: 'reactivation',
    triggerType: 'custom_event',
    triggerDescription: 'When a product is back in stock',
    estimatedDuration: '3 days',
    previewSteps: [
        'Back in stock trigger',
        'Send alert email immediately',
        'Wait 2 days',
        'Send last chance reminder',
    ],
    definition: {
        startNodeId: 'trigger-1',
        nodes: [
            {
                id: 'trigger-1',
                type: 'trigger',
                position: { x: NODE_START_X, y: NODE_START_Y },
                data: {
                    label: 'Back in Stock',
                    config: { triggerType: 'custom_event', eventType: 'product_back_in_stock' },
                },
            },
            {
                id: 'email-1',
                type: 'send_email',
                position: { x: NODE_START_X, y: NODE_START_Y + NODE_VERTICAL_SPACING },
                data: {
                    label: 'Back in Stock Alert',
                    config: {
                        subject: '🔔 {{productName}} is back in stock!',
                        body: "Hi {{name}},\n\nGreat news! {{productName}} is back in stock!\n\nYou asked to be notified, and we didn't want you to miss out.\n\n{{productName}}\n{{price}}\n\n[Shop Now]\n\nStock is limited, so don't wait too long!\n\nBest,\nThe Team",
                        preheader: "It's back! Get it before it's gone",
                    },
                },
            },
            {
                id: 'wait-1',
                type: 'wait',
                position: { x: NODE_START_X, y: NODE_START_Y + NODE_VERTICAL_SPACING * 2 },
                data: {
                    label: 'Wait 2 days',
                    config: { delay: 172800, unit: 'days' },
                },
            },
            {
                id: 'email-2',
                type: 'send_email',
                position: { x: NODE_START_X, y: NODE_START_Y + NODE_VERTICAL_SPACING * 3 },
                data: {
                    label: 'Last Chance Email',
                    config: {
                        subject: '⚠️ {{productName}} is selling fast!',
                        body: "Hi {{name}},\n\nJust wanted to let you know - {{productName}} is selling quickly!\n\nDon't miss your chance to get it this time.\n\n[Shop Now]\n\nBest,\nThe Team",
                        preheader: 'Limited stock remaining',
                    },
                },
            },
            {
                id: 'exit-1',
                type: 'exit_flow',
                position: { x: NODE_START_X, y: NODE_START_Y + NODE_VERTICAL_SPACING * 4 },
                data: {
                    label: 'Exit Flow',
                    config: { reason: 'Back in stock flow completed' },
                },
            },
        ],
        edges: [
            { id: 'e0', source: 'trigger-1', target: 'email-1' },
            { id: 'e1', source: 'email-1', target: 'wait-1' },
            { id: 'e2', source: 'wait-1', target: 'email-2' },
            { id: 'e3', source: 'email-2', target: 'exit-1' },
        ],
    },
};
const priceDropTemplate = {
    id: 'price-drop-alert',
    name: 'Price Drop Alert',
    description: 'Alert customers when a product they viewed or wishlisted drops in price. Creates urgency with limited-time pricing.',
    category: 'reactivation',
    triggerType: 'custom_event',
    triggerDescription: 'When a viewed product price drops',
    estimatedDuration: '3 days',
    previewSteps: [
        'Price drop trigger',
        'Send price drop alert immediately',
        'Wait 2 days',
        'Send final reminder',
    ],
    definition: {
        startNodeId: 'trigger-1',
        nodes: [
            {
                id: 'trigger-1',
                type: 'trigger',
                position: { x: NODE_START_X, y: NODE_START_Y },
                data: {
                    label: 'Price Drop',
                    config: { triggerType: 'custom_event', eventType: 'product_price_drop' },
                },
            },
            {
                id: 'email-1',
                type: 'send_email',
                position: { x: NODE_START_X, y: NODE_START_Y + NODE_VERTICAL_SPACING },
                data: {
                    label: 'Price Drop Alert',
                    config: {
                        subject: '💰 Price drop alert: {{productName}}!',
                        body: "Hi {{name}},\n\nGood news! {{productName}} just dropped in price!\n\nYou viewed this item recently, and now it's even more affordable.\n\n{{productName}}\nWas: {{price}}\nNow: {{discount}}\n\n[Shop the Sale]\n\nHurry - sale prices don't last forever!\n\nBest,\nThe Team",
                        preheader: 'The price just dropped on something you wanted',
                    },
                },
            },
            {
                id: 'wait-1',
                type: 'wait',
                position: { x: NODE_START_X, y: NODE_START_Y + NODE_VERTICAL_SPACING * 2 },
                data: {
                    label: 'Wait 2 days',
                    config: { delay: 172800, unit: 'days' },
                },
            },
            {
                id: 'email-2',
                type: 'send_email',
                position: { x: NODE_START_X, y: NODE_START_Y + NODE_VERTICAL_SPACING * 3 },
                data: {
                    label: 'Last Chance Email',
                    config: {
                        subject: '⏰ Sale ending soon on {{productName}}',
                        body: "Hi {{name}},\n\nJust a heads up - the sale on {{productName}} is ending soon!\n\nDon't miss this chance to save.\n\n[Shop Now]\n\nBest,\nThe Team",
                        preheader: 'Last chance for this price',
                    },
                },
            },
            {
                id: 'exit-1',
                type: 'exit_flow',
                position: { x: NODE_START_X, y: NODE_START_Y + NODE_VERTICAL_SPACING * 4 },
                data: {
                    label: 'Exit Flow',
                    config: { reason: 'Price drop flow completed' },
                },
            },
        ],
        edges: [
            { id: 'e0', source: 'trigger-1', target: 'email-1' },
            { id: 'e1', source: 'email-1', target: 'wait-1' },
            { id: 'e2', source: 'wait-1', target: 'email-2' },
            { id: 'e3', source: 'email-2', target: 'exit-1' },
        ],
    },
};
const doubleOptInTemplate = {
    id: 'double-opt-in',
    name: 'Double Opt-in Confirmation',
    description: 'Confirm email subscriptions with a verification link. Ensures list quality and GDPR compliance.',
    category: 'acquisition',
    triggerType: 'customer_joined_list',
    triggerDescription: 'When a new subscriber signs up',
    estimatedDuration: '2 days',
    previewSteps: [
        'Signup trigger',
        'Send confirmation email immediately',
        'Wait 24 hours',
        'Send reminder if not confirmed',
    ],
    definition: {
        startNodeId: 'trigger-1',
        nodes: [
            {
                id: 'trigger-1',
                type: 'trigger',
                position: { x: NODE_START_X, y: NODE_START_Y },
                data: {
                    label: 'New Subscriber',
                    config: { triggerType: 'customer_joined_list' },
                },
            },
            {
                id: 'email-1',
                type: 'send_email',
                position: { x: NODE_START_X, y: NODE_START_Y + NODE_VERTICAL_SPACING },
                data: {
                    label: 'Confirmation Email',
                    config: {
                        subject: 'Please confirm your subscription',
                        body: "Hi {{name}},\n\nThanks for signing up!\n\nPlease click the button below to confirm your subscription:\n\n[Confirm Subscription]\n\nIf you didn't sign up for our list, you can safely ignore this email.\n\nBest,\nThe Team",
                        preheader: 'One click to confirm',
                    },
                },
            },
            {
                id: 'wait-1',
                type: 'wait',
                position: { x: NODE_START_X, y: NODE_START_Y + NODE_VERTICAL_SPACING * 2 },
                data: {
                    label: 'Wait 24 hours',
                    config: { delay: 86400, unit: 'hours' },
                },
            },
            {
                id: 'email-2',
                type: 'send_email',
                position: { x: NODE_START_X, y: NODE_START_Y + NODE_VERTICAL_SPACING * 3 },
                data: {
                    label: 'Confirmation Reminder',
                    config: {
                        subject: "Don't forget to confirm your subscription",
                        body: "Hi {{name}},\n\nWe noticed you haven't confirmed your subscription yet.\n\nClick below to complete your signup and start receiving our updates:\n\n[Confirm Subscription]\n\nThis link will expire in 24 hours.\n\nBest,\nThe Team",
                        preheader: 'Complete your signup',
                    },
                },
            },
            {
                id: 'exit-1',
                type: 'exit_flow',
                position: { x: NODE_START_X, y: NODE_START_Y + NODE_VERTICAL_SPACING * 4 },
                data: {
                    label: 'Exit Flow',
                    config: { reason: 'Double opt-in completed' },
                },
            },
        ],
        edges: [
            { id: 'e0', source: 'trigger-1', target: 'email-1' },
            { id: 'e1', source: 'email-1', target: 'wait-1' },
            { id: 'e2', source: 'wait-1', target: 'email-2' },
            { id: 'e3', source: 'email-2', target: 'exit-1' },
        ],
    },
};
const subscriptionStartedTemplate = {
    id: 'subscription-started',
    name: 'Subscription Started',
    description: 'Welcome new subscription customers and help them get the most out of their subscription.',
    category: 'acquisition',
    triggerType: 'subscription_started',
    triggerDescription: 'When a customer starts a subscription',
    estimatedDuration: '7 days',
    previewSteps: [
        'Subscription started trigger',
        'Send welcome email',
        'Wait 3 days',
        'Send tips and tricks email',
        'Wait 4 days',
        'Send engagement check-in',
    ],
    definition: {
        startNodeId: 'trigger-1',
        nodes: [
            {
                id: 'trigger-1',
                type: 'trigger',
                position: { x: NODE_START_X, y: NODE_START_Y },
                data: {
                    label: 'Subscription Started',
                    config: { triggerType: 'subscription_started' },
                },
            },
            {
                id: 'email-1',
                type: 'send_email',
                position: { x: NODE_START_X, y: NODE_START_Y + NODE_VERTICAL_SPACING },
                data: {
                    label: 'Welcome Email',
                    config: {
                        subject: 'Welcome to your subscription, {{name}}!',
                        body: "Hi {{name}},\n\nWelcome aboard! Your subscription is now active.\n\nHere's what to expect:\n• Your first delivery will arrive within [X] days\n• You can manage your subscription anytime\n• Exclusive subscriber perks coming your way\n\nWe're so happy to have you!\n\nBest,\nThe Team",
                        preheader: 'Your subscription is active',
                    },
                },
            },
            {
                id: 'wait-1',
                type: 'wait',
                position: { x: NODE_START_X, y: NODE_START_Y + NODE_VERTICAL_SPACING * 2 },
                data: {
                    label: 'Wait 3 days',
                    config: { delay: 259200, unit: 'days' },
                },
            },
            {
                id: 'email-2',
                type: 'send_email',
                position: { x: NODE_START_X, y: NODE_START_Y + NODE_VERTICAL_SPACING * 3 },
                data: {
                    label: 'Tips Email',
                    config: {
                        subject: 'Get the most from your subscription, {{name}}',
                        body: 'Hi {{name}},\n\nWant to get the most out of your subscription? Here are some tips:\n\n1. [Tip 1]\n2. [Tip 2]\n3. [Tip 3]\n\nDid you know? Subscribers save an average of 20% compared to one-time purchases!\n\nBest,\nThe Team',
                        preheader: 'Pro tips for subscribers',
                    },
                },
            },
            {
                id: 'wait-2',
                type: 'wait',
                position: { x: NODE_START_X, y: NODE_START_Y + NODE_VERTICAL_SPACING * 4 },
                data: {
                    label: 'Wait 4 days',
                    config: { delay: 345600, unit: 'days' },
                },
            },
            {
                id: 'email-3',
                type: 'send_email',
                position: { x: NODE_START_X, y: NODE_START_Y + NODE_VERTICAL_SPACING * 5 },
                data: {
                    label: 'Check-in Email',
                    config: {
                        subject: "How's everything going, {{name}}?",
                        body: "Hi {{name}},\n\nJust checking in! How are you enjoying your subscription so far?\n\nIf you have any questions or feedback, we'd love to hear from you.\n\nRemember, you can adjust your subscription anytime:\n[Manage Subscription]\n\nBest,\nThe Team",
                        preheader: "We're here to help",
                    },
                },
            },
            {
                id: 'exit-1',
                type: 'exit_flow',
                position: { x: NODE_START_X, y: NODE_START_Y + NODE_VERTICAL_SPACING * 6 },
                data: {
                    label: 'Exit Flow',
                    config: { reason: 'Subscription onboarding completed' },
                },
            },
        ],
        edges: [
            { id: 'e0', source: 'trigger-1', target: 'email-1' },
            { id: 'e1', source: 'email-1', target: 'wait-1' },
            { id: 'e2', source: 'wait-1', target: 'email-2' },
            { id: 'e3', source: 'email-2', target: 'wait-2' },
            { id: 'e4', source: 'wait-2', target: 'email-3' },
            { id: 'e5', source: 'email-3', target: 'exit-1' },
        ],
    },
};
const subscriptionCancelledTemplate = {
    id: 'subscription-cancelled',
    name: 'Subscription Cancelled',
    description: 'Re-engage customers who cancelled their subscription. Offers incentives to return.',
    category: 'reactivation',
    triggerType: 'subscription_cancelled',
    triggerDescription: 'When a customer cancels their subscription',
    estimatedDuration: '14 days',
    previewSteps: [
        'Subscription cancelled trigger',
        'Send feedback request',
        'Wait 7 days',
        'Send win-back offer',
        'Wait 7 days',
        'Send final appeal',
    ],
    definition: {
        startNodeId: 'trigger-1',
        nodes: [
            {
                id: 'trigger-1',
                type: 'trigger',
                position: { x: NODE_START_X, y: NODE_START_Y },
                data: {
                    label: 'Subscription Cancelled',
                    config: { triggerType: 'subscription_cancelled' },
                },
            },
            {
                id: 'email-1',
                type: 'send_email',
                position: { x: NODE_START_X, y: NODE_START_Y + NODE_VERTICAL_SPACING },
                data: {
                    label: 'Feedback Request',
                    config: {
                        subject: "We're sorry to see you go, {{name}}",
                        body: "Hi {{name}},\n\nWe noticed you cancelled your subscription.\n\nWe're sorry to see you go! Would you mind sharing why you decided to cancel?\n\n[Share Feedback]\n\nYour feedback helps us improve for our customers.\n\nRemember, you can resubscribe anytime!\n\nBest,\nThe Team",
                        preheader: 'Your feedback matters to us',
                    },
                },
            },
            {
                id: 'wait-1',
                type: 'wait',
                position: { x: NODE_START_X, y: NODE_START_Y + NODE_VERTICAL_SPACING * 2 },
                data: {
                    label: 'Wait 7 days',
                    config: { delay: 604800, unit: 'days' },
                },
            },
            {
                id: 'email-2',
                type: 'send_email',
                position: { x: NODE_START_X, y: NODE_START_Y + NODE_VERTICAL_SPACING * 3 },
                data: {
                    label: 'Win-back Offer',
                    config: {
                        subject: 'We want you back, {{name}}! Special offer inside',
                        body: 'Hi {{name}},\n\nWe miss you! And we want to make it worth your while to come back.\n\nResubscribe now and get 30% off your first 3 months!\n\nUse code: COMEBACK30\n\n[Resubscribe Now]\n\nOffer expires in 7 days.\n\nBest,\nThe Team',
                        preheader: '30% off to come back',
                    },
                },
            },
            {
                id: 'wait-2',
                type: 'wait',
                position: { x: NODE_START_X, y: NODE_START_Y + NODE_VERTICAL_SPACING * 4 },
                data: {
                    label: 'Wait 7 days',
                    config: { delay: 604800, unit: 'days' },
                },
            },
            {
                id: 'email-3',
                type: 'send_email',
                position: { x: NODE_START_X, y: NODE_START_Y + NODE_VERTICAL_SPACING * 5 },
                data: {
                    label: 'Final Appeal',
                    config: {
                        subject: 'Last chance: {{name}}, your offer expires tomorrow',
                        body: "Hi {{name}},\n\nThis is your last chance to save 30% on your subscription!\n\nWe've made some improvements since you left:\n• [Improvement 1]\n• [Improvement 2]\n• [Improvement 3]\n\nUse code COMEBACK30 before it expires.\n\n[Resubscribe Now]\n\nBest,\nThe Team",
                        preheader: 'Your offer expires soon',
                    },
                },
            },
            {
                id: 'exit-1',
                type: 'exit_flow',
                position: { x: NODE_START_X, y: NODE_START_Y + NODE_VERTICAL_SPACING * 6 },
                data: {
                    label: 'Exit Flow',
                    config: { reason: 'Subscription win-back completed' },
                },
            },
        ],
        edges: [
            { id: 'e0', source: 'trigger-1', target: 'email-1' },
            { id: 'e1', source: 'email-1', target: 'wait-1' },
            { id: 'e2', source: 'wait-1', target: 'email-2' },
            { id: 'e3', source: 'email-2', target: 'wait-2' },
            { id: 'e4', source: 'wait-2', target: 'email-3' },
            { id: 'e5', source: 'email-3', target: 'exit-1' },
        ],
    },
};
const reorderReminderTemplate = {
    id: 'reorder-reminder',
    name: 'Reorder Reminder',
    description: 'Remind customers to reorder consumable products before they run out. Perfect for replenishment-based businesses.',
    category: 'retention',
    triggerType: 'custom_event',
    triggerDescription: 'When estimated product supply is running low',
    estimatedDuration: '7 days',
    previewSteps: ['Reorder trigger', 'Send reorder reminder', 'Wait 5 days', 'Send urgent reminder'],
    definition: {
        startNodeId: 'trigger-1',
        nodes: [
            {
                id: 'trigger-1',
                type: 'trigger',
                position: { x: NODE_START_X, y: NODE_START_Y },
                data: {
                    label: 'Reorder Time',
                    config: { triggerType: 'custom_event', eventType: 'reorder_reminder' },
                },
            },
            {
                id: 'email-1',
                type: 'send_email',
                position: { x: NODE_START_X, y: NODE_START_Y + NODE_VERTICAL_SPACING },
                data: {
                    label: 'Reorder Reminder',
                    config: {
                        subject: "Time to reorder, {{name}}? You're probably running low",
                        body: "Hi {{name}},\n\nBased on your last purchase, you're probably running low on {{productName}}!\n\nReorder now and never run out:\n\n{{productName}}\n{{price}}\n\n[Reorder Now]\n\nPro tip: Subscribe & Save 15% on every order!\n\nBest,\nThe Team",
                        preheader: "Don't run out!",
                    },
                },
            },
            {
                id: 'wait-1',
                type: 'wait',
                position: { x: NODE_START_X, y: NODE_START_Y + NODE_VERTICAL_SPACING * 2 },
                data: {
                    label: 'Wait 5 days',
                    config: { delay: 432000, unit: 'days' },
                },
            },
            {
                id: 'email-2',
                type: 'send_email',
                position: { x: NODE_START_X, y: NODE_START_Y + NODE_VERTICAL_SPACING * 3 },
                data: {
                    label: 'Urgent Reminder',
                    config: {
                        subject: '⚠️ {{name}}, you must be almost out!',
                        body: "Hi {{name}},\n\nYou're probably running very low on {{productName}} by now!\n\nDon't wait until you run out - order today and get free shipping:\n\n[Order Now with Free Shipping]\n\nBest,\nThe Team",
                        preheader: 'Free shipping on your reorder',
                    },
                },
            },
            {
                id: 'exit-1',
                type: 'exit_flow',
                position: { x: NODE_START_X, y: NODE_START_Y + NODE_VERTICAL_SPACING * 4 },
                data: {
                    label: 'Exit Flow',
                    config: { reason: 'Reorder reminder completed' },
                },
            },
        ],
        edges: [
            { id: 'e0', source: 'trigger-1', target: 'email-1' },
            { id: 'e1', source: 'email-1', target: 'wait-1' },
            { id: 'e2', source: 'wait-1', target: 'email-2' },
            { id: 'e3', source: 'email-2', target: 'exit-1' },
        ],
    },
};
const vipRecognitionTemplate = {
    id: 'vip-recognition',
    name: 'VIP Customer Recognition',
    description: 'Recognize and reward your best customers when they reach VIP status. Builds loyalty and encourages continued engagement.',
    category: 'retention',
    triggerType: 'custom_event',
    triggerDescription: 'When a customer reaches VIP status',
    estimatedDuration: '1 day',
    previewSteps: ['VIP status trigger', 'Send VIP welcome email with exclusive perks'],
    definition: {
        startNodeId: 'trigger-1',
        nodes: [
            {
                id: 'trigger-1',
                type: 'trigger',
                position: { x: NODE_START_X, y: NODE_START_Y },
                data: {
                    label: 'VIP Status Reached',
                    config: { triggerType: 'custom_event', eventType: 'customer_vip_status' },
                },
            },
            {
                id: 'email-1',
                type: 'send_email',
                position: { x: NODE_START_X, y: NODE_START_Y + NODE_VERTICAL_SPACING },
                data: {
                    label: 'VIP Welcome',
                    config: {
                        subject: "🌟 Congratulations {{name}}! You're now a VIP",
                        body: "Hi {{name}},\n\n🎉 Congratulations! You've achieved VIP status!\n\nAs one of our most valued customers, you now have access to exclusive perks:\n\n✨ Early access to new products\n✨ Exclusive VIP-only discounts\n✨ Free priority shipping\n✨ Dedicated customer support\n\nTo celebrate, here's 20% off your next order: VIP20\n\nThank you for being amazing!\n\nBest,\nThe Team",
                        preheader: 'Welcome to the VIP club!',
                    },
                },
            },
            {
                id: 'exit-1',
                type: 'exit_flow',
                position: { x: NODE_START_X, y: NODE_START_Y + NODE_VERTICAL_SPACING * 2 },
                data: {
                    label: 'Exit Flow',
                    config: { reason: 'VIP recognition completed' },
                },
            },
        ],
        edges: [
            { id: 'e0', source: 'trigger-1', target: 'email-1' },
            { id: 'e1', source: 'email-1', target: 'exit-1' },
        ],
    },
};
const loyaltyMilestoneTemplate = {
    id: 'loyalty-milestone',
    name: 'Loyalty Milestone',
    description: 'Celebrate customer milestones like anniversaries or purchase counts. Strengthens relationships and encourages repeat purchases.',
    category: 'retention',
    triggerType: 'custom_event',
    triggerDescription: 'When a customer reaches a loyalty milestone',
    estimatedDuration: '1 day',
    previewSteps: ['Milestone trigger', 'Send celebration email with reward'],
    definition: {
        startNodeId: 'trigger-1',
        nodes: [
            {
                id: 'trigger-1',
                type: 'trigger',
                position: { x: NODE_START_X, y: NODE_START_Y },
                data: {
                    label: 'Milestone Reached',
                    config: { triggerType: 'custom_event', eventType: 'loyalty_milestone' },
                },
            },
            {
                id: 'email-1',
                type: 'send_email',
                position: { x: NODE_START_X, y: NODE_START_Y + NODE_VERTICAL_SPACING },
                data: {
                    label: 'Milestone Email',
                    config: {
                        subject: "🎊 {{name}}, you've reached a milestone!",
                        body: "Hi {{name}},\n\n🎉 Congratulations on reaching a special milestone with us!\n\nYou've been a loyal customer, and we couldn't be more grateful.\n\nTo celebrate, here's a special gift:\n\nUse code MILESTONE15 for 15% off your next order!\n\nThank you for being part of our journey.\n\nBest,\nThe Team",
                        preheader: 'A special reward for you',
                    },
                },
            },
            {
                id: 'exit-1',
                type: 'exit_flow',
                position: { x: NODE_START_X, y: NODE_START_Y + NODE_VERTICAL_SPACING * 2 },
                data: {
                    label: 'Exit Flow',
                    config: { reason: 'Milestone celebration completed' },
                },
            },
        ],
        edges: [
            { id: 'e0', source: 'trigger-1', target: 'email-1' },
            { id: 'e1', source: 'email-1', target: 'exit-1' },
        ],
    },
};
const leadMagnetTemplate = {
    id: 'lead-magnet-delivery',
    name: 'Lead Magnet Delivery',
    description: 'Deliver lead magnets instantly and nurture new leads with follow-up content.',
    category: 'acquisition',
    triggerType: 'custom_event',
    triggerDescription: 'When a lead requests a lead magnet',
    estimatedDuration: '5 days',
    previewSteps: [
        'Lead magnet request trigger',
        'Send download link immediately',
        'Wait 2 days',
        'Send related content',
        'Wait 3 days',
        'Send conversion offer',
    ],
    definition: {
        startNodeId: 'trigger-1',
        nodes: [
            {
                id: 'trigger-1',
                type: 'trigger',
                position: { x: NODE_START_X, y: NODE_START_Y },
                data: {
                    label: 'Lead Magnet Request',
                    config: { triggerType: 'custom_event', eventType: 'lead_magnet_request' },
                },
            },
            {
                id: 'email-1',
                type: 'send_email',
                position: { x: NODE_START_X, y: NODE_START_Y + NODE_VERTICAL_SPACING },
                data: {
                    label: 'Delivery Email',
                    config: {
                        subject: "{{name}}, here's your download!",
                        body: 'Hi {{name}},\n\nThanks for requesting our guide!\n\nClick below to download:\n\n[Download Now]\n\nWe hope you find it valuable. Stay tuned for more helpful content!\n\nBest,\nThe Team',
                        preheader: 'Your download is ready',
                    },
                },
            },
            {
                id: 'wait-1',
                type: 'wait',
                position: { x: NODE_START_X, y: NODE_START_Y + NODE_VERTICAL_SPACING * 2 },
                data: {
                    label: 'Wait 2 days',
                    config: { delay: 172800, unit: 'days' },
                },
            },
            {
                id: 'email-2',
                type: 'send_email',
                position: { x: NODE_START_X, y: NODE_START_Y + NODE_VERTICAL_SPACING * 3 },
                data: {
                    label: 'Follow-up Content',
                    config: {
                        subject: 'More tips for you, {{name}}',
                        body: 'Hi {{name}},\n\nHope you enjoyed the guide!\n\nHere are some additional resources you might find helpful:\n\n• [Resource 1]\n• [Resource 2]\n• [Resource 3]\n\nQuestions? Just reply to this email!\n\nBest,\nThe Team',
                        preheader: 'Additional resources inside',
                    },
                },
            },
            {
                id: 'wait-2',
                type: 'wait',
                position: { x: NODE_START_X, y: NODE_START_Y + NODE_VERTICAL_SPACING * 4 },
                data: {
                    label: 'Wait 3 days',
                    config: { delay: 259200, unit: 'days' },
                },
            },
            {
                id: 'email-3',
                type: 'send_email',
                position: { x: NODE_START_X, y: NODE_START_Y + NODE_VERTICAL_SPACING * 5 },
                data: {
                    label: 'Conversion Offer',
                    config: {
                        subject: 'Ready to take the next step, {{name}}?',
                        body: "Hi {{name}},\n\nNow that you've learned the basics, ready to put them into action?\n\nGet started with 20% off your first purchase:\n\nUse code: NEWSTART20\n\n[Shop Now]\n\nBest,\nThe Team",
                        preheader: 'Special offer for you',
                    },
                },
            },
            {
                id: 'exit-1',
                type: 'exit_flow',
                position: { x: NODE_START_X, y: NODE_START_Y + NODE_VERTICAL_SPACING * 6 },
                data: {
                    label: 'Exit Flow',
                    config: { reason: 'Lead magnet nurture completed' },
                },
            },
        ],
        edges: [
            { id: 'e0', source: 'trigger-1', target: 'email-1' },
            { id: 'e1', source: 'email-1', target: 'wait-1' },
            { id: 'e2', source: 'wait-1', target: 'email-2' },
            { id: 'e3', source: 'email-2', target: 'wait-2' },
            { id: 'e4', source: 'wait-2', target: 'email-3' },
            { id: 'e5', source: 'email-3', target: 'exit-1' },
        ],
    },
};
const referralProgramTemplate = {
    id: 'referral-program',
    name: 'Referral Program Welcome',
    description: 'Welcome customers to your referral program and encourage them to share with friends.',
    category: 'acquisition',
    triggerType: 'custom_event',
    triggerDescription: 'When a customer joins the referral program',
    estimatedDuration: '7 days',
    previewSteps: [
        'Referral signup trigger',
        'Send welcome with referral link',
        'Wait 5 days',
        'Send referral reminder',
    ],
    definition: {
        startNodeId: 'trigger-1',
        nodes: [
            {
                id: 'trigger-1',
                type: 'trigger',
                position: { x: NODE_START_X, y: NODE_START_Y },
                data: {
                    label: 'Referral Signup',
                    config: { triggerType: 'custom_event', eventType: 'referral_signup' },
                },
            },
            {
                id: 'email-1',
                type: 'send_email',
                position: { x: NODE_START_X, y: NODE_START_Y + NODE_VERTICAL_SPACING },
                data: {
                    label: 'Referral Welcome',
                    config: {
                        subject: '🎁 Your referral link is ready, {{name}}!',
                        body: "Hi {{name}},\n\nWelcome to our referral program!\n\nHere's how it works:\n\n1. Share your unique link with friends\n2. They get 15% off their first order\n3. You get $10 credit for each friend who orders!\n\nYour referral link:\n[Your Unique Link]\n\n[Share Now]\n\nStart sharing and earning!\n\nBest,\nThe Team",
                        preheader: 'Start earning rewards today',
                    },
                },
            },
            {
                id: 'wait-1',
                type: 'wait',
                position: { x: NODE_START_X, y: NODE_START_Y + NODE_VERTICAL_SPACING * 2 },
                data: {
                    label: 'Wait 5 days',
                    config: { delay: 432000, unit: 'days' },
                },
            },
            {
                id: 'email-2',
                type: 'send_email',
                position: { x: NODE_START_X, y: NODE_START_Y + NODE_VERTICAL_SPACING * 3 },
                data: {
                    label: 'Referral Reminder',
                    config: {
                        subject: '{{name}}, have you shared your referral link yet?',
                        body: 'Hi {{name}},\n\nJust a reminder that you can earn $10 for every friend you refer!\n\nShare your link on:\n• Social media\n• Email\n• Text message\n\n[Share Now]\n\nYour friends will thank you (and so will your wallet)!\n\nBest,\nThe Team',
                        preheader: "Don't forget to share!",
                    },
                },
            },
            {
                id: 'exit-1',
                type: 'exit_flow',
                position: { x: NODE_START_X, y: NODE_START_Y + NODE_VERTICAL_SPACING * 4 },
                data: {
                    label: 'Exit Flow',
                    config: { reason: 'Referral program flow completed' },
                },
            },
        ],
        edges: [
            { id: 'e0', source: 'trigger-1', target: 'email-1' },
            { id: 'e1', source: 'email-1', target: 'wait-1' },
            { id: 'e2', source: 'wait-1', target: 'email-2' },
            { id: 'e3', source: 'email-2', target: 'exit-1' },
        ],
    },
};
const paymentFailedTemplate = {
    id: 'payment-failed',
    name: 'Payment Failed Recovery',
    description: 'Recover failed payments with friendly reminders and easy update options.',
    category: 'engagement',
    triggerType: 'custom_event',
    triggerDescription: 'When a payment fails',
    estimatedDuration: '7 days',
    previewSteps: [
        'Payment failed trigger',
        'Send payment failed notice',
        'Wait 3 days',
        'Send reminder',
        'Wait 3 days',
        'Send final notice',
    ],
    definition: {
        startNodeId: 'trigger-1',
        nodes: [
            {
                id: 'trigger-1',
                type: 'trigger',
                position: { x: NODE_START_X, y: NODE_START_Y },
                data: {
                    label: 'Payment Failed',
                    config: { triggerType: 'custom_event', eventType: 'payment_failed' },
                },
            },
            {
                id: 'email-1',
                type: 'send_email',
                position: { x: NODE_START_X, y: NODE_START_Y + NODE_VERTICAL_SPACING },
                data: {
                    label: 'Payment Failed Notice',
                    config: {
                        subject: '{{name}}, there was an issue with your payment',
                        body: "Hi {{name}},\n\nWe had trouble processing your recent payment.\n\nThis can happen for a few reasons:\n• Expired card\n• Insufficient funds\n• Bank security hold\n\nPlease update your payment method to avoid service interruption:\n\n[Update Payment Method]\n\nIf you need help, we're here for you!\n\nBest,\nThe Team",
                        preheader: 'Action required: Payment issue',
                    },
                },
            },
            {
                id: 'wait-1',
                type: 'wait',
                position: { x: NODE_START_X, y: NODE_START_Y + NODE_VERTICAL_SPACING * 2 },
                data: {
                    label: 'Wait 3 days',
                    config: { delay: 259200, unit: 'days' },
                },
            },
            {
                id: 'email-2',
                type: 'send_email',
                position: { x: NODE_START_X, y: NODE_START_Y + NODE_VERTICAL_SPACING * 3 },
                data: {
                    label: 'Payment Reminder',
                    config: {
                        subject: 'Reminder: Please update your payment, {{name}}',
                        body: "Hi {{name}},\n\nWe still need you to update your payment method.\n\nDon't worry - it only takes a minute:\n\n[Update Payment Method]\n\nNeed help? Just reply to this email.\n\nBest,\nThe Team",
                        preheader: 'Quick update needed',
                    },
                },
            },
            {
                id: 'wait-2',
                type: 'wait',
                position: { x: NODE_START_X, y: NODE_START_Y + NODE_VERTICAL_SPACING * 4 },
                data: {
                    label: 'Wait 3 days',
                    config: { delay: 259200, unit: 'days' },
                },
            },
            {
                id: 'email-3',
                type: 'send_email',
                position: { x: NODE_START_X, y: NODE_START_Y + NODE_VERTICAL_SPACING * 5 },
                data: {
                    label: 'Final Notice',
                    config: {
                        subject: '⚠️ Final notice: Your account may be suspended',
                        body: "Hi {{name}},\n\nThis is our final reminder about your payment issue.\n\nTo keep your account active, please update your payment method today:\n\n[Update Payment Method]\n\nIf we don't hear from you, your service may be interrupted.\n\nBest,\nThe Team",
                        preheader: 'Action required immediately',
                    },
                },
            },
            {
                id: 'exit-1',
                type: 'exit_flow',
                position: { x: NODE_START_X, y: NODE_START_Y + NODE_VERTICAL_SPACING * 6 },
                data: {
                    label: 'Exit Flow',
                    config: { reason: 'Payment recovery completed' },
                },
            },
        ],
        edges: [
            { id: 'e0', source: 'trigger-1', target: 'email-1' },
            { id: 'e1', source: 'email-1', target: 'wait-1' },
            { id: 'e2', source: 'wait-1', target: 'email-2' },
            { id: 'e3', source: 'email-2', target: 'wait-2' },
            { id: 'e4', source: 'wait-2', target: 'email-3' },
            { id: 'e5', source: 'email-3', target: 'exit-1' },
        ],
    },
};
const flashSaleTemplate = {
    id: 'flash-sale',
    name: 'Flash Sale Notification',
    description: 'Announce flash sales and create urgency with countdown messaging.',
    category: 'engagement',
    triggerType: 'custom_event',
    triggerDescription: 'When a flash sale starts',
    estimatedDuration: '1 day',
    previewSteps: [
        'Flash sale trigger',
        'Send announcement',
        'Wait 12 hours',
        'Send last chance reminder',
    ],
    definition: {
        startNodeId: 'trigger-1',
        nodes: [
            {
                id: 'trigger-1',
                type: 'trigger',
                position: { x: NODE_START_X, y: NODE_START_Y },
                data: {
                    label: 'Flash Sale Start',
                    config: { triggerType: 'custom_event', eventType: 'flash_sale_start' },
                },
            },
            {
                id: 'email-1',
                type: 'send_email',
                position: { x: NODE_START_X, y: NODE_START_Y + NODE_VERTICAL_SPACING },
                data: {
                    label: 'Flash Sale Announcement',
                    config: {
                        subject: '⚡ FLASH SALE: 24 hours only!',
                        body: "Hi {{name}},\n\n⚡ FLASH SALE ALERT ⚡\n\nFor the next 24 hours only:\n\nUp to 50% OFF EVERYTHING!\n\nNo code needed - discounts apply at checkout.\n\n[Shop the Sale]\n\nHurry - this won't last long!\n\nBest,\nThe Team",
                        preheader: '24-hour flash sale starts NOW',
                    },
                },
            },
            {
                id: 'wait-1',
                type: 'wait',
                position: { x: NODE_START_X, y: NODE_START_Y + NODE_VERTICAL_SPACING * 2 },
                data: {
                    label: 'Wait 12 hours',
                    config: { delay: 43200, unit: 'hours' },
                },
            },
            {
                id: 'email-2',
                type: 'send_email',
                position: { x: NODE_START_X, y: NODE_START_Y + NODE_VERTICAL_SPACING * 3 },
                data: {
                    label: 'Last Chance',
                    config: {
                        subject: '⏰ 12 HOURS LEFT: Flash sale ending!',
                        body: "Hi {{name}},\n\n⏰ ONLY 12 HOURS LEFT!\n\nOur flash sale is ending soon!\n\nDon't miss your chance to save up to 50%.\n\n[Shop Now Before It's Gone]\n\nBest,\nThe Team",
                        preheader: 'Sale ends in 12 hours',
                    },
                },
            },
            {
                id: 'exit-1',
                type: 'exit_flow',
                position: { x: NODE_START_X, y: NODE_START_Y + NODE_VERTICAL_SPACING * 4 },
                data: {
                    label: 'Exit Flow',
                    config: { reason: 'Flash sale flow completed' },
                },
            },
        ],
        edges: [
            { id: 'e0', source: 'trigger-1', target: 'email-1' },
            { id: 'e1', source: 'email-1', target: 'wait-1' },
            { id: 'e2', source: 'wait-1', target: 'email-2' },
            { id: 'e3', source: 'email-2', target: 'exit-1' },
        ],
    },
};
const newProductLaunchTemplate = {
    id: 'new-product-launch',
    name: 'New Product Launch',
    description: 'Build excitement for new product launches with teaser and launch emails.',
    category: 'engagement',
    triggerType: 'custom_event',
    triggerDescription: 'When a new product is launched',
    estimatedDuration: '3 days',
    previewSteps: [
        'Product launch trigger',
        'Send launch announcement',
        'Wait 2 days',
        'Send follow-up with reviews',
    ],
    definition: {
        startNodeId: 'trigger-1',
        nodes: [
            {
                id: 'trigger-1',
                type: 'trigger',
                position: { x: NODE_START_X, y: NODE_START_Y },
                data: {
                    label: 'Product Launch',
                    config: { triggerType: 'custom_event', eventType: 'new_product_launch' },
                },
            },
            {
                id: 'email-1',
                type: 'send_email',
                position: { x: NODE_START_X, y: NODE_START_Y + NODE_VERTICAL_SPACING },
                data: {
                    label: 'Launch Announcement',
                    config: {
                        subject: '🚀 NEW: Introducing {{productName}}!',
                        body: "Hi {{name}},\n\n🚀 IT'S HERE!\n\nWe're thrilled to introduce our newest addition:\n\n{{productName}}\n{{price}}\n\n[Product Image]\n\nWhy you'll love it:\n• [Feature 1]\n• [Feature 2]\n• [Feature 3]\n\n[Shop Now]\n\nBe one of the first to try it!\n\nBest,\nThe Team",
                        preheader: 'Just launched - be the first to see it',
                    },
                },
            },
            {
                id: 'wait-1',
                type: 'wait',
                position: { x: NODE_START_X, y: NODE_START_Y + NODE_VERTICAL_SPACING * 2 },
                data: {
                    label: 'Wait 2 days',
                    config: { delay: 172800, unit: 'days' },
                },
            },
            {
                id: 'email-2',
                type: 'send_email',
                position: { x: NODE_START_X, y: NODE_START_Y + NODE_VERTICAL_SPACING * 3 },
                data: {
                    label: 'Reviews Email',
                    config: {
                        subject: 'See what people are saying about {{productName}}',
                        body: 'Hi {{name}},\n\n{{productName}} is getting rave reviews!\n\n⭐⭐⭐⭐⭐\n"[Customer Review 1]"\n- Customer Name\n\n⭐⭐⭐⭐⭐\n"[Customer Review 2]"\n- Customer Name\n\nReady to see what the hype is about?\n\n[Shop Now]\n\nBest,\nThe Team',
                        preheader: 'Customers are loving it',
                    },
                },
            },
            {
                id: 'exit-1',
                type: 'exit_flow',
                position: { x: NODE_START_X, y: NODE_START_Y + NODE_VERTICAL_SPACING * 4 },
                data: {
                    label: 'Exit Flow',
                    config: { reason: 'Product launch flow completed' },
                },
            },
        ],
        edges: [
            { id: 'e0', source: 'trigger-1', target: 'email-1' },
            { id: 'e1', source: 'email-1', target: 'wait-1' },
            { id: 'e2', source: 'wait-1', target: 'email-2' },
            { id: 'e3', source: 'email-2', target: 'exit-1' },
        ],
    },
};
const feedbackRequestTemplate = {
    id: 'feedback-request',
    name: 'Feedback Request',
    description: 'Collect valuable customer feedback and NPS scores to improve your business.',
    category: 'engagement',
    triggerType: 'custom_event',
    triggerDescription: 'When triggered for feedback collection',
    estimatedDuration: '5 days',
    previewSteps: ['Feedback trigger', 'Send feedback request', 'Wait 3 days', 'Send reminder'],
    definition: {
        startNodeId: 'trigger-1',
        nodes: [
            {
                id: 'trigger-1',
                type: 'trigger',
                position: { x: NODE_START_X, y: NODE_START_Y },
                data: {
                    label: 'Feedback Request',
                    config: { triggerType: 'custom_event', eventType: 'feedback_request' },
                },
            },
            {
                id: 'email-1',
                type: 'send_email',
                position: { x: NODE_START_X, y: NODE_START_Y + NODE_VERTICAL_SPACING },
                data: {
                    label: 'Feedback Request',
                    config: {
                        subject: "{{name}}, we'd love your feedback (2 min survey)",
                        body: 'Hi {{name}},\n\nYour opinion matters to us!\n\nWould you take 2 minutes to share your feedback?\n\nOn a scale of 0-10, how likely are you to recommend us to a friend?\n\n[Take the Survey]\n\nYour insights help us serve you better.\n\nThank you!\n\nBest,\nThe Team',
                        preheader: 'Quick 2-minute survey',
                    },
                },
            },
            {
                id: 'wait-1',
                type: 'wait',
                position: { x: NODE_START_X, y: NODE_START_Y + NODE_VERTICAL_SPACING * 2 },
                data: {
                    label: 'Wait 3 days',
                    config: { delay: 259200, unit: 'days' },
                },
            },
            {
                id: 'email-2',
                type: 'send_email',
                position: { x: NODE_START_X, y: NODE_START_Y + NODE_VERTICAL_SPACING * 3 },
                data: {
                    label: 'Feedback Reminder',
                    config: {
                        subject: 'Quick reminder: We still want to hear from you',
                        body: "Hi {{name}},\n\nWe noticed you haven't completed our feedback survey yet.\n\nIt really only takes 2 minutes, and your input is incredibly valuable to us.\n\n[Complete Survey]\n\nThank you for helping us improve!\n\nBest,\nThe Team",
                        preheader: 'Your feedback matters',
                    },
                },
            },
            {
                id: 'exit-1',
                type: 'exit_flow',
                position: { x: NODE_START_X, y: NODE_START_Y + NODE_VERTICAL_SPACING * 4 },
                data: {
                    label: 'Exit Flow',
                    config: { reason: 'Feedback request completed' },
                },
            },
        ],
        edges: [
            { id: 'e0', source: 'trigger-1', target: 'email-1' },
            { id: 'e1', source: 'email-1', target: 'wait-1' },
            { id: 'e2', source: 'wait-1', target: 'email-2' },
            { id: 'e3', source: 'email-2', target: 'exit-1' },
        ],
    },
};
const seasonalReengagementTemplate = {
    id: 'seasonal-reengagement',
    name: 'Seasonal Re-engagement',
    description: 'Re-engage dormant customers during key shopping seasons like Black Friday, holidays, etc.',
    category: 'reactivation',
    triggerType: 'custom_event',
    triggerDescription: 'When a seasonal campaign is triggered',
    estimatedDuration: '5 days',
    previewSteps: ['Seasonal trigger', 'Send seasonal offer', 'Wait 3 days', 'Send reminder'],
    definition: {
        startNodeId: 'trigger-1',
        nodes: [
            {
                id: 'trigger-1',
                type: 'trigger',
                position: { x: NODE_START_X, y: NODE_START_Y },
                data: {
                    label: 'Seasonal Campaign',
                    config: { triggerType: 'custom_event', eventType: 'seasonal_campaign' },
                },
            },
            {
                id: 'email-1',
                type: 'send_email',
                position: { x: NODE_START_X, y: NODE_START_Y + NODE_VERTICAL_SPACING },
                data: {
                    label: 'Seasonal Offer',
                    config: {
                        subject: "🎄 {{name}}, we've missed you! Special holiday offer inside",
                        body: "Hi {{name}},\n\nIt's been a while, and we miss you!\n\nTo celebrate the season, we have a special offer just for you:\n\n25% OFF your next order\nUse code: SEASON25\n\n[Shop Now]\n\nOffer valid for 7 days.\n\nWarm wishes,\nThe Team",
                        preheader: 'Exclusive seasonal offer inside',
                    },
                },
            },
            {
                id: 'wait-1',
                type: 'wait',
                position: { x: NODE_START_X, y: NODE_START_Y + NODE_VERTICAL_SPACING * 2 },
                data: {
                    label: 'Wait 3 days',
                    config: { delay: 259200, unit: 'days' },
                },
            },
            {
                id: 'email-2',
                type: 'send_email',
                position: { x: NODE_START_X, y: NODE_START_Y + NODE_VERTICAL_SPACING * 3 },
                data: {
                    label: 'Offer Reminder',
                    config: {
                        subject: "Don't forget: Your 25% off expires soon, {{name}}",
                        body: "Hi {{name}},\n\nJust a reminder that your special seasonal offer expires soon!\n\n25% OFF with code: SEASON25\n\n[Shop Now]\n\nDon't miss out!\n\nBest,\nThe Team",
                        preheader: 'Your offer is expiring',
                    },
                },
            },
            {
                id: 'exit-1',
                type: 'exit_flow',
                position: { x: NODE_START_X, y: NODE_START_Y + NODE_VERTICAL_SPACING * 4 },
                data: {
                    label: 'Exit Flow',
                    config: { reason: 'Seasonal re-engagement completed' },
                },
            },
        ],
        edges: [
            { id: 'e0', source: 'trigger-1', target: 'email-1' },
            { id: 'e1', source: 'email-1', target: 'wait-1' },
            { id: 'e2', source: 'wait-1', target: 'email-2' },
            { id: 'e3', source: 'email-2', target: 'exit-1' },
        ],
    },
};
const crossSellTemplate = {
    id: 'cross-sell-recommendation',
    name: 'Cross-sell Recommendation',
    description: 'Recommend complementary products to customers based on their recent purchase.',
    category: 'retention',
    triggerType: 'order_placed',
    triggerDescription: 'When a customer completes a purchase',
    estimatedDuration: '10 days',
    previewSteps: [
        'Order placed trigger',
        'Wait 7 days (delivery)',
        'Send cross-sell recommendations',
        'Wait 3 days',
        'Send reminder with discount',
    ],
    definition: {
        startNodeId: 'trigger-1',
        nodes: [
            {
                id: 'trigger-1',
                type: 'trigger',
                position: { x: NODE_START_X, y: NODE_START_Y },
                data: {
                    label: 'Order Placed',
                    config: { triggerType: 'order_placed' },
                },
            },
            {
                id: 'wait-1',
                type: 'wait',
                position: { x: NODE_START_X, y: NODE_START_Y + NODE_VERTICAL_SPACING },
                data: {
                    label: 'Wait 7 days',
                    config: { delay: 604800, unit: 'days' },
                },
            },
            {
                id: 'email-1',
                type: 'send_email',
                position: { x: NODE_START_X, y: NODE_START_Y + NODE_VERTICAL_SPACING * 2 },
                data: {
                    label: 'Cross-sell Email',
                    config: {
                        subject: '{{name}}, complete your collection',
                        body: 'Hi {{name}},\n\nLoving your recent purchase? Here are some items that go perfectly with it:\n\n[Product 1 - Image, Name, Price]\n[Product 2 - Image, Name, Price]\n[Product 3 - Image, Name, Price]\n\n[Shop Recommendations]\n\nThese items are handpicked based on what you bought.\n\nBest,\nThe Team',
                        preheader: 'Perfect pairings for your purchase',
                    },
                },
            },
            {
                id: 'wait-2',
                type: 'wait',
                position: { x: NODE_START_X, y: NODE_START_Y + NODE_VERTICAL_SPACING * 3 },
                data: {
                    label: 'Wait 3 days',
                    config: { delay: 259200, unit: 'days' },
                },
            },
            {
                id: 'email-2',
                type: 'send_email',
                position: { x: NODE_START_X, y: NODE_START_Y + NODE_VERTICAL_SPACING * 4 },
                data: {
                    label: 'Discount Reminder',
                    config: {
                        subject: 'Get 15% off those items you were eyeing, {{name}}',
                        body: "Hi {{name}},\n\nStill thinking about those recommendations?\n\nHere's a little nudge: Use code COMPLETE15 for 15% off!\n\n[Shop Now]\n\nOffer expires in 48 hours.\n\nBest,\nThe Team",
                        preheader: '15% off just for you',
                    },
                },
            },
            {
                id: 'exit-1',
                type: 'exit_flow',
                position: { x: NODE_START_X, y: NODE_START_Y + NODE_VERTICAL_SPACING * 5 },
                data: {
                    label: 'Exit Flow',
                    config: { reason: 'Cross-sell flow completed' },
                },
            },
        ],
        edges: [
            { id: 'e0', source: 'trigger-1', target: 'wait-1' },
            { id: 'e1', source: 'wait-1', target: 'email-1' },
            { id: 'e2', source: 'email-1', target: 'wait-2' },
            { id: 'e3', source: 'wait-2', target: 'email-2' },
            { id: 'e4', source: 'email-2', target: 'exit-1' },
        ],
    },
};
const educationalDripTemplate = {
    id: 'educational-drip',
    name: 'Educational Drip Series',
    description: 'Educate your audience with a series of valuable content emails. Great for building authority and trust.',
    category: 'engagement',
    triggerType: 'custom_event',
    triggerDescription: 'When a customer opts into educational content',
    estimatedDuration: '10 days',
    previewSteps: [
        'Optin trigger',
        'Send lesson 1',
        'Wait 3 days',
        'Send lesson 2',
        'Wait 3 days',
        'Send lesson 3',
        'Wait 3 days',
        'Send completion + offer',
    ],
    definition: {
        startNodeId: 'trigger-1',
        nodes: [
            {
                id: 'trigger-1',
                type: 'trigger',
                position: { x: NODE_START_X, y: NODE_START_Y },
                data: {
                    label: 'Content Optin',
                    config: { triggerType: 'custom_event', eventType: 'educational_optin' },
                },
            },
            {
                id: 'email-1',
                type: 'send_email',
                position: { x: NODE_START_X, y: NODE_START_Y + NODE_VERTICAL_SPACING },
                data: {
                    label: 'Lesson 1',
                    config: {
                        subject: '[Lesson 1] Getting started with...',
                        body: "Hi {{name}},\n\nWelcome to your learning journey!\n\nIn this first lesson, we'll cover the basics:\n\n[Lesson 1 Content]\n\nKey takeaways:\n• Point 1\n• Point 2\n• Point 3\n\nSee you in the next lesson!\n\nBest,\nThe Team",
                        preheader: 'Lesson 1 of 3',
                    },
                },
            },
            {
                id: 'wait-1',
                type: 'wait',
                position: { x: NODE_START_X, y: NODE_START_Y + NODE_VERTICAL_SPACING * 2 },
                data: {
                    label: 'Wait 3 days',
                    config: { delay: 259200, unit: 'days' },
                },
            },
            {
                id: 'email-2',
                type: 'send_email',
                position: { x: NODE_START_X, y: NODE_START_Y + NODE_VERTICAL_SPACING * 3 },
                data: {
                    label: 'Lesson 2',
                    config: {
                        subject: '[Lesson 2] Taking it to the next level...',
                        body: "Hi {{name}},\n\nReady for lesson 2? Let's dive deeper!\n\n[Lesson 2 Content]\n\nKey takeaways:\n• Point 1\n• Point 2\n• Point 3\n\nOne more lesson to go!\n\nBest,\nThe Team",
                        preheader: 'Lesson 2 of 3',
                    },
                },
            },
            {
                id: 'wait-2',
                type: 'wait',
                position: { x: NODE_START_X, y: NODE_START_Y + NODE_VERTICAL_SPACING * 4 },
                data: {
                    label: 'Wait 3 days',
                    config: { delay: 259200, unit: 'days' },
                },
            },
            {
                id: 'email-3',
                type: 'send_email',
                position: { x: NODE_START_X, y: NODE_START_Y + NODE_VERTICAL_SPACING * 5 },
                data: {
                    label: 'Lesson 3 + Offer',
                    config: {
                        subject: '[Final Lesson] Putting it all together + special offer',
                        body: "Hi {{name}},\n\nCongratulations on completing the series!\n\n[Final Lesson Content]\n\nYou've learned:\n✅ [Topic 1]\n✅ [Topic 2]\n✅ [Topic 3]\n\nReady to put your knowledge into action?\n\nAs a thank you for completing the course, here's 20% off:\n\nUse code: GRADUATE20\n\n[Shop Now]\n\nBest,\nThe Team",
                        preheader: 'Final lesson + your reward',
                    },
                },
            },
            {
                id: 'exit-1',
                type: 'exit_flow',
                position: { x: NODE_START_X, y: NODE_START_Y + NODE_VERTICAL_SPACING * 6 },
                data: {
                    label: 'Exit Flow',
                    config: { reason: 'Educational series completed' },
                },
            },
        ],
        edges: [
            { id: 'e0', source: 'trigger-1', target: 'email-1' },
            { id: 'e1', source: 'email-1', target: 'wait-1' },
            { id: 'e2', source: 'wait-1', target: 'email-2' },
            { id: 'e3', source: 'email-2', target: 'wait-2' },
            { id: 'e4', source: 'wait-2', target: 'email-3' },
            { id: 'e5', source: 'email-3', target: 'exit-1' },
        ],
    },
};
const lowStockAlertTemplate = {
    id: 'low-stock-alert',
    name: 'Low Stock Alert',
    description: 'Alert customers when items they viewed or wishlisted are running low on stock.',
    category: 'reactivation',
    triggerType: 'custom_event',
    triggerDescription: 'When a viewed product has low stock',
    estimatedDuration: '1 day',
    previewSteps: ['Low stock trigger', 'Send low stock alert immediately'],
    definition: {
        startNodeId: 'trigger-1',
        nodes: [
            {
                id: 'trigger-1',
                type: 'trigger',
                position: { x: NODE_START_X, y: NODE_START_Y },
                data: {
                    label: 'Low Stock Alert',
                    config: { triggerType: 'custom_event', eventType: 'product_low_stock' },
                },
            },
            {
                id: 'email-1',
                type: 'send_email',
                position: { x: NODE_START_X, y: NODE_START_Y + NODE_VERTICAL_SPACING },
                data: {
                    label: 'Low Stock Email',
                    config: {
                        subject: '⚠️ {{productName}} is almost sold out!',
                        body: "Hi {{name}},\n\nHeads up! {{productName}} is running low on stock.\n\nYou viewed this item recently, and we don't want you to miss out!\n\n{{productName}}\n{{price}}\nOnly a few left!\n\n[Get It Before It's Gone]\n\nBest,\nThe Team",
                        preheader: 'Almost sold out - act fast!',
                    },
                },
            },
            {
                id: 'exit-1',
                type: 'exit_flow',
                position: { x: NODE_START_X, y: NODE_START_Y + NODE_VERTICAL_SPACING * 2 },
                data: {
                    label: 'Exit Flow',
                    config: { reason: 'Low stock alert completed' },
                },
            },
        ],
        edges: [
            { id: 'e0', source: 'trigger-1', target: 'email-1' },
            { id: 'e1', source: 'email-1', target: 'exit-1' },
        ],
    },
};
const accountSecurityTemplate = {
    id: 'account-security-alert',
    name: 'Account Security Alert',
    description: 'Alert customers to security-related account activities like password changes or new logins.',
    category: 'engagement',
    triggerType: 'custom_event',
    triggerDescription: 'When a security-related event occurs',
    estimatedDuration: 'Immediate',
    previewSteps: ['Security event trigger', 'Send security alert immediately'],
    definition: {
        startNodeId: 'trigger-1',
        nodes: [
            {
                id: 'trigger-1',
                type: 'trigger',
                position: { x: NODE_START_X, y: NODE_START_Y },
                data: {
                    label: 'Security Event',
                    config: { triggerType: 'custom_event', eventType: 'account_security' },
                },
            },
            {
                id: 'email-1',
                type: 'send_email',
                position: { x: NODE_START_X, y: NODE_START_Y + NODE_VERTICAL_SPACING },
                data: {
                    label: 'Security Alert',
                    config: {
                        subject: '🔒 Security alert for your account',
                        body: "Hi {{name}},\n\nWe detected a security-related activity on your account:\n\n[Activity Description]\nTime: [Timestamp]\nLocation: [Location if available]\n\nIf this was you, no action is needed.\n\nIf you didn't make this change, please secure your account immediately:\n\n[Reset Password]\n[Contact Support]\n\nYour security is our priority.\n\nBest,\nThe Team",
                        preheader: 'Important security notification',
                    },
                },
            },
            {
                id: 'exit-1',
                type: 'exit_flow',
                position: { x: NODE_START_X, y: NODE_START_Y + NODE_VERTICAL_SPACING * 2 },
                data: {
                    label: 'Exit Flow',
                    config: { reason: 'Security alert sent' },
                },
            },
        ],
        edges: [
            { id: 'e0', source: 'trigger-1', target: 'email-1' },
            { id: 'e1', source: 'email-1', target: 'exit-1' },
        ],
    },
};
const upsellTemplate = {
    id: 'upsell-upgrade',
    name: 'Upsell / Upgrade',
    description: 'Encourage customers to upgrade to premium products or larger quantities.',
    category: 'retention',
    triggerType: 'order_placed',
    triggerDescription: 'When a customer places an order',
    estimatedDuration: '5 days',
    previewSteps: [
        'Order placed trigger',
        'Wait 3 days',
        'Send upsell offer',
        'Wait 2 days',
        'Send reminder',
    ],
    definition: {
        startNodeId: 'trigger-1',
        nodes: [
            {
                id: 'trigger-1',
                type: 'trigger',
                position: { x: NODE_START_X, y: NODE_START_Y },
                data: {
                    label: 'Order Placed',
                    config: { triggerType: 'order_placed' },
                },
            },
            {
                id: 'wait-1',
                type: 'wait',
                position: { x: NODE_START_X, y: NODE_START_Y + NODE_VERTICAL_SPACING },
                data: {
                    label: 'Wait 3 days',
                    config: { delay: 259200, unit: 'days' },
                },
            },
            {
                id: 'email-1',
                type: 'send_email',
                position: { x: NODE_START_X, y: NODE_START_Y + NODE_VERTICAL_SPACING * 2 },
                data: {
                    label: 'Upsell Offer',
                    config: {
                        subject: '{{name}}, upgrade and save even more!',
                        body: "Hi {{name}},\n\nLoving your purchase? Here's how to get even more value:\n\nUpgrade to our [Premium/Larger] option and:\n• Get [X]% more product\n• Save [Y]% per unit\n• Enjoy [Benefit]\n\n[Upgrade Now]\n\nUpgrade within 48 hours and get free shipping!\n\nBest,\nThe Team",
                        preheader: 'Upgrade and save',
                    },
                },
            },
            {
                id: 'wait-2',
                type: 'wait',
                position: { x: NODE_START_X, y: NODE_START_Y + NODE_VERTICAL_SPACING * 3 },
                data: {
                    label: 'Wait 2 days',
                    config: { delay: 172800, unit: 'days' },
                },
            },
            {
                id: 'email-2',
                type: 'send_email',
                position: { x: NODE_START_X, y: NODE_START_Y + NODE_VERTICAL_SPACING * 4 },
                data: {
                    label: 'Upgrade Reminder',
                    config: {
                        subject: 'Last chance to upgrade with free shipping, {{name}}',
                        body: "Hi {{name}},\n\nYour free shipping upgrade offer expires today!\n\nDon't miss your chance to save more:\n\n[Upgrade Now]\n\nBest,\nThe Team",
                        preheader: 'Free shipping expires today',
                    },
                },
            },
            {
                id: 'exit-1',
                type: 'exit_flow',
                position: { x: NODE_START_X, y: NODE_START_Y + NODE_VERTICAL_SPACING * 5 },
                data: {
                    label: 'Exit Flow',
                    config: { reason: 'Upsell flow completed' },
                },
            },
        ],
        edges: [
            { id: 'e0', source: 'trigger-1', target: 'wait-1' },
            { id: 'e1', source: 'wait-1', target: 'email-1' },
            { id: 'e2', source: 'email-1', target: 'wait-2' },
            { id: 'e3', source: 'wait-2', target: 'email-2' },
            { id: 'e4', source: 'email-2', target: 'exit-1' },
        ],
    },
};
const eventReminderTemplate = {
    id: 'event-reminder',
    name: 'Event Reminder',
    description: 'Send reminders for upcoming events, webinars, or appointments.',
    category: 'engagement',
    triggerType: 'custom_event',
    triggerDescription: 'When an event is approaching',
    estimatedDuration: '1 day',
    previewSteps: [
        'Event reminder trigger',
        'Send 24-hour reminder',
        'Wait 23 hours',
        'Send 1-hour reminder',
    ],
    definition: {
        startNodeId: 'trigger-1',
        nodes: [
            {
                id: 'trigger-1',
                type: 'trigger',
                position: { x: NODE_START_X, y: NODE_START_Y },
                data: {
                    label: 'Event Approaching',
                    config: { triggerType: 'custom_event', eventType: 'event_reminder' },
                },
            },
            {
                id: 'email-1',
                type: 'send_email',
                position: { x: NODE_START_X, y: NODE_START_Y + NODE_VERTICAL_SPACING },
                data: {
                    label: '24-Hour Reminder',
                    config: {
                        subject: '📅 Reminder: Your event is tomorrow!',
                        body: 'Hi {{name}},\n\nJust a friendly reminder that [Event Name] is happening tomorrow!\n\n📅 Date: [Date]\n⏰ Time: [Time]\n📍 Location: [Location/Link]\n\nWhat to expect:\n• [Agenda item 1]\n• [Agenda item 2]\n• [Agenda item 3]\n\n[Add to Calendar]\n\nSee you there!\n\nBest,\nThe Team',
                        preheader: 'Your event is tomorrow',
                    },
                },
            },
            {
                id: 'wait-1',
                type: 'wait',
                position: { x: NODE_START_X, y: NODE_START_Y + NODE_VERTICAL_SPACING * 2 },
                data: {
                    label: 'Wait 23 hours',
                    config: { delay: 82800, unit: 'hours' },
                },
            },
            {
                id: 'email-2',
                type: 'send_email',
                position: { x: NODE_START_X, y: NODE_START_Y + NODE_VERTICAL_SPACING * 3 },
                data: {
                    label: '1-Hour Reminder',
                    config: {
                        subject: '⏰ Starting in 1 hour: [Event Name]',
                        body: "Hi {{name}},\n\n[Event Name] starts in just 1 hour!\n\n[Join Link/Location]\n\nWe can't wait to see you!\n\nBest,\nThe Team",
                        preheader: 'Starting soon!',
                    },
                },
            },
            {
                id: 'exit-1',
                type: 'exit_flow',
                position: { x: NODE_START_X, y: NODE_START_Y + NODE_VERTICAL_SPACING * 4 },
                data: {
                    label: 'Exit Flow',
                    config: { reason: 'Event reminder flow completed' },
                },
            },
        ],
        edges: [
            { id: 'e0', source: 'trigger-1', target: 'email-1' },
            { id: 'e1', source: 'email-1', target: 'wait-1' },
            { id: 'e2', source: 'wait-1', target: 'email-2' },
            { id: 'e3', source: 'email-2', target: 'exit-1' },
        ],
    },
};
const webinarFollowupTemplate = {
    id: 'webinar-followup',
    name: 'Webinar Follow-up',
    description: 'Follow up with webinar attendees with recording and next steps. Also re-engage no-shows.',
    category: 'engagement',
    triggerType: 'custom_event',
    triggerDescription: 'After a webinar ends',
    estimatedDuration: '3 days',
    previewSteps: [
        'Webinar ended trigger',
        'Send recording + resources',
        'Wait 2 days',
        'Send CTA offer',
    ],
    definition: {
        startNodeId: 'trigger-1',
        nodes: [
            {
                id: 'trigger-1',
                type: 'trigger',
                position: { x: NODE_START_X, y: NODE_START_Y },
                data: {
                    label: 'Webinar Ended',
                    config: { triggerType: 'custom_event', eventType: 'webinar_ended' },
                },
            },
            {
                id: 'email-1',
                type: 'send_email',
                position: { x: NODE_START_X, y: NODE_START_Y + NODE_VERTICAL_SPACING },
                data: {
                    label: 'Recording Email',
                    config: {
                        subject: '🎬 [Webinar Name] recording + resources',
                        body: "Hi {{name}},\n\nThank you for attending [Webinar Name]!\n\nHere's everything you need:\n\n📹 Watch the Recording:\n[Recording Link]\n\n📥 Download Resources:\n• [Resource 1]\n• [Resource 2]\n• [Slides]\n\nHave questions? Reply to this email!\n\nBest,\nThe Team",
                        preheader: 'Your recording is ready',
                    },
                },
            },
            {
                id: 'wait-1',
                type: 'wait',
                position: { x: NODE_START_X, y: NODE_START_Y + NODE_VERTICAL_SPACING * 2 },
                data: {
                    label: 'Wait 2 days',
                    config: { delay: 172800, unit: 'days' },
                },
            },
            {
                id: 'email-2',
                type: 'send_email',
                position: { x: NODE_START_X, y: NODE_START_Y + NODE_VERTICAL_SPACING * 3 },
                data: {
                    label: 'CTA Email',
                    config: {
                        subject: 'Ready to take the next step, {{name}}?',
                        body: 'Hi {{name}},\n\nHope you enjoyed the webinar!\n\nReady to put what you learned into action?\n\nWebinar attendees get an exclusive offer:\n\n[Special Offer Description]\n\nUse code: WEBINAR20 for 20% off\n\n[Claim Your Offer]\n\nOffer expires in 48 hours.\n\nBest,\nThe Team',
                        preheader: 'Exclusive attendee offer',
                    },
                },
            },
            {
                id: 'exit-1',
                type: 'exit_flow',
                position: { x: NODE_START_X, y: NODE_START_Y + NODE_VERTICAL_SPACING * 4 },
                data: {
                    label: 'Exit Flow',
                    config: { reason: 'Webinar follow-up completed' },
                },
            },
        ],
        edges: [
            { id: 'e0', source: 'trigger-1', target: 'email-1' },
            { id: 'e1', source: 'email-1', target: 'wait-1' },
            { id: 'e2', source: 'wait-1', target: 'email-2' },
            { id: 'e3', source: 'email-2', target: 'exit-1' },
        ],
    },
};
const surveyInvitationTemplate = {
    id: 'survey-invitation',
    name: 'Survey Invitation',
    description: 'Invite customers to participate in surveys or research studies.',
    category: 'engagement',
    triggerType: 'custom_event',
    triggerDescription: 'When a survey campaign is triggered',
    estimatedDuration: '5 days',
    previewSteps: ['Survey trigger', 'Send survey invitation', 'Wait 3 days', 'Send reminder'],
    definition: {
        startNodeId: 'trigger-1',
        nodes: [
            {
                id: 'trigger-1',
                type: 'trigger',
                position: { x: NODE_START_X, y: NODE_START_Y },
                data: {
                    label: 'Survey Campaign',
                    config: { triggerType: 'custom_event', eventType: 'survey_campaign' },
                },
            },
            {
                id: 'email-1',
                type: 'send_email',
                position: { x: NODE_START_X, y: NODE_START_Y + NODE_VERTICAL_SPACING },
                data: {
                    label: 'Survey Invitation',
                    config: {
                        subject: '{{name}}, we need your help (5 min survey)',
                        body: "Hi {{name}},\n\nWe're conducting a quick survey to better understand our customers.\n\nYour input directly shapes our future products and services!\n\n⏱️ Time: ~5 minutes\n🎁 Reward: [Incentive if any]\n\n[Take the Survey]\n\nYour feedback is incredibly valuable to us.\n\nThank you!\n\nBest,\nThe Team",
                        preheader: 'Your opinion matters',
                    },
                },
            },
            {
                id: 'wait-1',
                type: 'wait',
                position: { x: NODE_START_X, y: NODE_START_Y + NODE_VERTICAL_SPACING * 2 },
                data: {
                    label: 'Wait 3 days',
                    config: { delay: 259200, unit: 'days' },
                },
            },
            {
                id: 'email-2',
                type: 'send_email',
                position: { x: NODE_START_X, y: NODE_START_Y + NODE_VERTICAL_SPACING * 3 },
                data: {
                    label: 'Survey Reminder',
                    config: {
                        subject: "Quick reminder: We'd still love your feedback, {{name}}",
                        body: 'Hi {{name}},\n\nJust a quick reminder about our survey!\n\nIt only takes 5 minutes, and your input helps us serve you better.\n\n[Take the Survey]\n\nThank you for considering!\n\nBest,\nThe Team',
                        preheader: 'Last chance to share your feedback',
                    },
                },
            },
            {
                id: 'exit-1',
                type: 'exit_flow',
                position: { x: NODE_START_X, y: NODE_START_Y + NODE_VERTICAL_SPACING * 4 },
                data: {
                    label: 'Exit Flow',
                    config: { reason: 'Survey invitation completed' },
                },
            },
        ],
        edges: [
            { id: 'e0', source: 'trigger-1', target: 'email-1' },
            { id: 'e1', source: 'email-1', target: 'wait-1' },
            { id: 'e2', source: 'wait-1', target: 'email-2' },
            { id: 'e3', source: 'email-2', target: 'exit-1' },
        ],
    },
};
const sunsetFlowTemplate = {
    id: 'sunset-flow',
    name: 'Sunset Flow',
    description: 'Last attempt to re-engage unresponsive subscribers before removing them from your list.',
    category: 'reactivation',
    triggerType: 'custom_event',
    triggerDescription: 'When a subscriber becomes chronically unengaged',
    estimatedDuration: '7 days',
    previewSteps: [
        'Unengaged trigger',
        'Send re-engagement attempt',
        'Wait 5 days',
        'Send final goodbye',
    ],
    definition: {
        startNodeId: 'trigger-1',
        nodes: [
            {
                id: 'trigger-1',
                type: 'trigger',
                position: { x: NODE_START_X, y: NODE_START_Y },
                data: {
                    label: 'Unengaged Subscriber',
                    config: { triggerType: 'custom_event', eventType: 'subscriber_sunset' },
                },
            },
            {
                id: 'email-1',
                type: 'send_email',
                position: { x: NODE_START_X, y: NODE_START_Y + NODE_VERTICAL_SPACING },
                data: {
                    label: 'Re-engagement Email',
                    config: {
                        subject: '{{name}}, are you still there?',
                        body: "Hi {{name}},\n\nWe noticed you haven't opened our emails in a while.\n\nWe don't want to bother you with emails you don't want, so we wanted to check in.\n\nWant to keep hearing from us?\n\n[Yes, Keep Me Subscribed]\n\nIf we don't hear from you, we'll remove you from our list to respect your inbox.\n\nBest,\nThe Team",
                        preheader: 'Should we keep in touch?',
                    },
                },
            },
            {
                id: 'wait-1',
                type: 'wait',
                position: { x: NODE_START_X, y: NODE_START_Y + NODE_VERTICAL_SPACING * 2 },
                data: {
                    label: 'Wait 5 days',
                    config: { delay: 432000, unit: 'days' },
                },
            },
            {
                id: 'email-2',
                type: 'send_email',
                position: { x: NODE_START_X, y: NODE_START_Y + NODE_VERTICAL_SPACING * 3 },
                data: {
                    label: 'Goodbye Email',
                    config: {
                        subject: 'Goodbye for now, {{name}}',
                        body: "Hi {{name}},\n\nSince we haven't heard from you, we're going to stop sending you emails.\n\nIf you ever want to come back, you're always welcome:\n\n[Re-subscribe]\n\nWe wish you all the best!\n\nBest,\nThe Team",
                        preheader: 'This is goodbye (for now)',
                    },
                },
            },
            {
                id: 'exit-1',
                type: 'exit_flow',
                position: { x: NODE_START_X, y: NODE_START_Y + NODE_VERTICAL_SPACING * 4 },
                data: {
                    label: 'Exit Flow',
                    config: { reason: 'Sunset flow completed - subscriber to be removed' },
                },
            },
        ],
        edges: [
            { id: 'e0', source: 'trigger-1', target: 'email-1' },
            { id: 'e1', source: 'email-1', target: 'wait-1' },
            { id: 'e2', source: 'wait-1', target: 'email-2' },
            { id: 'e3', source: 'email-2', target: 'exit-1' },
        ],
    },
};
const shippingConfirmationTemplate = {
    id: 'shipping-confirmation',
    name: 'Shipping Confirmation',
    description: 'Keep customers informed about their shipment status with tracking updates.',
    category: 'engagement',
    triggerType: 'order_fulfilled',
    triggerDescription: 'When an order ships',
    estimatedDuration: '5 days',
    previewSteps: [
        'Order shipped trigger',
        'Send shipping confirmation',
        'Wait 3 days',
        'Send delivery update',
    ],
    definition: {
        startNodeId: 'trigger-1',
        nodes: [
            {
                id: 'trigger-1',
                type: 'trigger',
                position: { x: NODE_START_X, y: NODE_START_Y },
                data: {
                    label: 'Order Shipped',
                    config: { triggerType: 'order_fulfilled' },
                },
            },
            {
                id: 'email-1',
                type: 'send_email',
                position: { x: NODE_START_X, y: NODE_START_Y + NODE_VERTICAL_SPACING },
                data: {
                    label: 'Shipping Confirmation',
                    config: {
                        subject: '📦 {{name}}, your order has shipped!',
                        body: 'Hi {{name}},\n\nGreat news! Your order is on its way!\n\n📦 Order #[Order Number]\n📍 Shipping to: [Address]\n🚚 Carrier: [Carrier Name]\n📋 Tracking: [Tracking Number]\n\n[Track Your Package]\n\nEstimated delivery: [Date]\n\nBest,\nThe Team',
                        preheader: 'Your order is on the way!',
                    },
                },
            },
            {
                id: 'wait-1',
                type: 'wait',
                position: { x: NODE_START_X, y: NODE_START_Y + NODE_VERTICAL_SPACING * 2 },
                data: {
                    label: 'Wait 3 days',
                    config: { delay: 259200, unit: 'days' },
                },
            },
            {
                id: 'email-2',
                type: 'send_email',
                position: { x: NODE_START_X, y: NODE_START_Y + NODE_VERTICAL_SPACING * 3 },
                data: {
                    label: 'Delivery Update',
                    config: {
                        subject: '🚚 {{name}}, your package should arrive soon!',
                        body: "Hi {{name}},\n\nYour package is getting close!\n\n[Track Your Package]\n\nOnce it arrives, we'd love to hear what you think!\n\nBest,\nThe Team",
                        preheader: 'Almost there!',
                    },
                },
            },
            {
                id: 'exit-1',
                type: 'exit_flow',
                position: { x: NODE_START_X, y: NODE_START_Y + NODE_VERTICAL_SPACING * 4 },
                data: {
                    label: 'Exit Flow',
                    config: { reason: 'Shipping confirmation completed' },
                },
            },
        ],
        edges: [
            { id: 'e0', source: 'trigger-1', target: 'email-1' },
            { id: 'e1', source: 'email-1', target: 'wait-1' },
            { id: 'e2', source: 'wait-1', target: 'email-2' },
            { id: 'e3', source: 'email-2', target: 'exit-1' },
        ],
    },
};
const trialStartedTemplate = {
    id: 'trial-started',
    name: 'Trial Started',
    description: 'Guide new trial users through your product and convert them to paying customers.',
    category: 'acquisition',
    triggerType: 'subscription_started',
    triggerDescription: 'When a trial starts',
    estimatedDuration: '14 days',
    previewSteps: [
        'Trial starts trigger',
        'Send welcome email',
        'Wait 2 days',
        'Send feature guide',
        'Wait 5 days',
        'Send conversion offer',
    ],
    definition: {
        startNodeId: 'trigger-1',
        nodes: [
            {
                id: 'trigger-1',
                type: 'trigger',
                position: { x: NODE_START_X, y: NODE_START_Y },
                data: {
                    label: 'Trial Started',
                    config: { triggerType: 'subscription_started' },
                },
            },
            {
                id: 'email-1',
                type: 'send_email',
                position: { x: NODE_START_X, y: NODE_START_Y + NODE_VERTICAL_SPACING },
                data: {
                    label: 'Welcome to Trial',
                    config: {
                        subject: '🎉 Welcome to your free trial, {{name}}!',
                        body: "Hi {{name}},\n\nWelcome! Your free trial is now active.\n\nHere's what you can do:\n✅ Feature 1\n✅ Feature 2\n✅ Feature 3\n\n[Get Started Now]\n\nYour trial ends in 14 days.\n\nBest,\nThe Team",
                        preheader: "Your trial is ready - let's get started!",
                    },
                },
            },
            {
                id: 'wait-1',
                type: 'wait',
                position: { x: NODE_START_X, y: NODE_START_Y + NODE_VERTICAL_SPACING * 2 },
                data: {
                    label: 'Wait 2 days',
                    config: { delay: 172800, unit: 'days' },
                },
            },
            {
                id: 'email-2',
                type: 'send_email',
                position: { x: NODE_START_X, y: NODE_START_Y + NODE_VERTICAL_SPACING * 3 },
                data: {
                    label: 'Feature Guide',
                    config: {
                        subject: '💡 {{name}}, discover these powerful features',
                        body: 'Hi {{name}},\n\nAre you getting the most out of your trial?\n\nHere are 3 features our power users love:\n\n1. [Feature A] - How it helps\n2. [Feature B] - Why it matters\n3. [Feature C] - Quick tip\n\n[Watch Quick Tutorial]\n\nBest,\nThe Team',
                        preheader: 'Make the most of your trial',
                    },
                },
            },
            {
                id: 'wait-2',
                type: 'wait',
                position: { x: NODE_START_X, y: NODE_START_Y + NODE_VERTICAL_SPACING * 4 },
                data: {
                    label: 'Wait 5 days',
                    config: { delay: 432000, unit: 'days' },
                },
            },
            {
                id: 'email-3',
                type: 'send_email',
                position: { x: NODE_START_X, y: NODE_START_Y + NODE_VERTICAL_SPACING * 5 },
                data: {
                    label: 'Conversion Offer',
                    config: {
                        subject: '⏰ {{name}}, your trial ends soon - special offer inside',
                        body: "Hi {{name}},\n\nYour trial ends in 7 days!\n\nUpgrade now and get:\n🎁 20% off your first year\n🎁 Priority support\n🎁 Extended features\n\n[Upgrade Now]\n\nDon't lose access to your work.\n\nBest,\nThe Team",
                        preheader: 'Special offer before your trial ends',
                    },
                },
            },
            {
                id: 'exit-1',
                type: 'exit_flow',
                position: { x: NODE_START_X, y: NODE_START_Y + NODE_VERTICAL_SPACING * 6 },
                data: {
                    label: 'Exit Flow',
                    config: { reason: 'Trial onboarding completed' },
                },
            },
        ],
        edges: [
            { id: 'e0', source: 'trigger-1', target: 'email-1' },
            { id: 'e1', source: 'email-1', target: 'wait-1' },
            { id: 'e2', source: 'wait-1', target: 'email-2' },
            { id: 'e3', source: 'email-2', target: 'wait-2' },
            { id: 'e4', source: 'wait-2', target: 'email-3' },
            { id: 'e5', source: 'email-3', target: 'exit-1' },
        ],
    },
};
const waitlistTemplate = {
    id: 'waitlist',
    name: 'Waitlist',
    description: 'Keep waitlist subscribers engaged and excited before launch.',
    category: 'acquisition',
    triggerType: 'customer_joined_list',
    triggerDescription: 'When someone joins the waitlist',
    estimatedDuration: 'Until launch',
    previewSteps: [
        'Joins waitlist trigger',
        'Send confirmation',
        'Wait 7 days',
        'Send update/teaser',
    ],
    definition: {
        startNodeId: 'trigger-1',
        nodes: [
            {
                id: 'trigger-1',
                type: 'trigger',
                position: { x: NODE_START_X, y: NODE_START_Y },
                data: {
                    label: 'Joined Waitlist',
                    config: { triggerType: 'customer_joined_list' },
                },
            },
            {
                id: 'email-1',
                type: 'send_email',
                position: { x: NODE_START_X, y: NODE_START_Y + NODE_VERTICAL_SPACING },
                data: {
                    label: 'Waitlist Confirmation',
                    config: {
                        subject: "🎯 You're on the list, {{name}}!",
                        body: "Hi {{name}},\n\nYou're officially on the waitlist!\n\nYour position: #[Position]\n\nWhat happens next:\n1. We'll notify you as soon as we launch\n2. Early access members get exclusive perks\n3. Share with friends to move up the list\n\n[Share & Move Up]\n\nBest,\nThe Team",
                        preheader: "You're in! Here's what to expect",
                    },
                },
            },
            {
                id: 'wait-1',
                type: 'wait',
                position: { x: NODE_START_X, y: NODE_START_Y + NODE_VERTICAL_SPACING * 2 },
                data: {
                    label: 'Wait 7 days',
                    config: { delay: 604800, unit: 'days' },
                },
            },
            {
                id: 'email-2',
                type: 'send_email',
                position: { x: NODE_START_X, y: NODE_START_Y + NODE_VERTICAL_SPACING * 3 },
                data: {
                    label: 'Progress Update',
                    config: {
                        subject: '👀 Sneak peek for waitlist members',
                        body: "Hi {{name}},\n\nWe've been working hard behind the scenes!\n\nHere's an exclusive preview:\n[Preview Content]\n\nWe're getting closer to launch. Stay tuned!\n\nBest,\nThe Team",
                        preheader: 'Exclusive preview for you',
                    },
                },
            },
            {
                id: 'exit-1',
                type: 'exit_flow',
                position: { x: NODE_START_X, y: NODE_START_Y + NODE_VERTICAL_SPACING * 4 },
                data: {
                    label: 'Exit Flow',
                    config: { reason: 'Waitlist engagement completed' },
                },
            },
        ],
        edges: [
            { id: 'e0', source: 'trigger-1', target: 'email-1' },
            { id: 'e1', source: 'email-1', target: 'wait-1' },
            { id: 'e2', source: 'wait-1', target: 'email-2' },
            { id: 'e3', source: 'email-2', target: 'exit-1' },
        ],
    },
};
const earlyAccessTemplate = {
    id: 'early-access',
    name: 'Early Access',
    description: 'Welcome early access members with exclusive benefits and content.',
    category: 'acquisition',
    triggerType: 'customer_joined_list',
    triggerDescription: 'When granted early access',
    estimatedDuration: '7 days',
    previewSteps: [
        'Early access granted trigger',
        'Send exclusive welcome',
        'Wait 3 days',
        'Send VIP content',
    ],
    definition: {
        startNodeId: 'trigger-1',
        nodes: [
            {
                id: 'trigger-1',
                type: 'trigger',
                position: { x: NODE_START_X, y: NODE_START_Y },
                data: {
                    label: 'Early Access Granted',
                    config: { triggerType: 'customer_joined_list' },
                },
            },
            {
                id: 'email-1',
                type: 'send_email',
                position: { x: NODE_START_X, y: NODE_START_Y + NODE_VERTICAL_SPACING },
                data: {
                    label: 'Early Access Welcome',
                    config: {
                        subject: '🌟 {{name}}, your early access is ready!',
                        body: 'Hi {{name}},\n\nCongratulations! You now have early access!\n\nAs an early member, you get:\n✨ First look at new features\n✨ Direct feedback channel\n✨ Founding member pricing\n✨ Exclusive community access\n\n[Access Now]\n\nWelcome to the inner circle!\n\nBest,\nThe Team',
                        preheader: 'Your exclusive access is ready',
                    },
                },
            },
            {
                id: 'wait-1',
                type: 'wait',
                position: { x: NODE_START_X, y: NODE_START_Y + NODE_VERTICAL_SPACING * 2 },
                data: {
                    label: 'Wait 3 days',
                    config: { delay: 259200, unit: 'days' },
                },
            },
            {
                id: 'email-2',
                type: 'send_email',
                position: { x: NODE_START_X, y: NODE_START_Y + NODE_VERTICAL_SPACING * 3 },
                data: {
                    label: 'VIP Content',
                    config: {
                        subject: '🔐 Exclusive content for early access members',
                        body: "Hi {{name}},\n\nAs an early access member, here's exclusive content just for you:\n\n[Exclusive Content/Feature]\n\nYour feedback shapes our product. Reply to share your thoughts!\n\nBest,\nThe Team",
                        preheader: 'Exclusive for early access',
                    },
                },
            },
            {
                id: 'exit-1',
                type: 'exit_flow',
                position: { x: NODE_START_X, y: NODE_START_Y + NODE_VERTICAL_SPACING * 4 },
                data: {
                    label: 'Exit Flow',
                    config: { reason: 'Early access welcome completed' },
                },
            },
        ],
        edges: [
            { id: 'e0', source: 'trigger-1', target: 'email-1' },
            { id: 'e1', source: 'email-1', target: 'wait-1' },
            { id: 'e2', source: 'wait-1', target: 'email-2' },
            { id: 'e3', source: 'email-2', target: 'exit-1' },
        ],
    },
};
const newsletterWelcomeTemplate = {
    id: 'newsletter-welcome',
    name: 'Newsletter Welcome',
    description: 'Welcome new newsletter subscribers and set expectations.',
    category: 'acquisition',
    triggerType: 'customer_joined_list',
    triggerDescription: 'When someone subscribes to newsletter',
    estimatedDuration: '5 days',
    previewSteps: [
        'Newsletter signup trigger',
        'Send welcome + best content',
        'Wait 3 days',
        'Send content roundup',
    ],
    definition: {
        startNodeId: 'trigger-1',
        nodes: [
            {
                id: 'trigger-1',
                type: 'trigger',
                position: { x: NODE_START_X, y: NODE_START_Y },
                data: {
                    label: 'Newsletter Signup',
                    config: { triggerType: 'customer_joined_list' },
                },
            },
            {
                id: 'email-1',
                type: 'send_email',
                position: { x: NODE_START_X, y: NODE_START_Y + NODE_VERTICAL_SPACING },
                data: {
                    label: 'Newsletter Welcome',
                    config: {
                        subject: '📬 Welcome to our newsletter, {{name}}!',
                        body: 'Hi {{name}},\n\nThanks for subscribing!\n\nWhat to expect:\n📅 Weekly insights every Tuesday\n💡 Exclusive tips and strategies\n🎁 Subscriber-only offers\n\nTo start, here are our most popular articles:\n[Popular Content Links]\n\nBest,\nThe Team',
                        preheader: 'Thanks for subscribing!',
                    },
                },
            },
            {
                id: 'wait-1',
                type: 'wait',
                position: { x: NODE_START_X, y: NODE_START_Y + NODE_VERTICAL_SPACING * 2 },
                data: {
                    label: 'Wait 3 days',
                    config: { delay: 259200, unit: 'days' },
                },
            },
            {
                id: 'email-2',
                type: 'send_email',
                position: { x: NODE_START_X, y: NODE_START_Y + NODE_VERTICAL_SPACING * 3 },
                data: {
                    label: 'Content Roundup',
                    config: {
                        subject: '📚 {{name}}, your content roundup',
                        body: "Hi {{name}},\n\nHere's a curated selection of our best content:\n\n📖 [Article 1]\n📖 [Article 2]\n📖 [Article 3]\n\nEnjoy the read!\n\nBest,\nThe Team",
                        preheader: 'Your curated content selection',
                    },
                },
            },
            {
                id: 'exit-1',
                type: 'exit_flow',
                position: { x: NODE_START_X, y: NODE_START_Y + NODE_VERTICAL_SPACING * 4 },
                data: {
                    label: 'Exit Flow',
                    config: { reason: 'Newsletter welcome completed' },
                },
            },
        ],
        edges: [
            { id: 'e0', source: 'trigger-1', target: 'email-1' },
            { id: 'e1', source: 'email-1', target: 'wait-1' },
            { id: 'e2', source: 'wait-1', target: 'email-2' },
            { id: 'e3', source: 'email-2', target: 'exit-1' },
        ],
    },
};
const giftCardPurchaseTemplate = {
    id: 'gift-card-purchase',
    name: 'Gift Card Purchase',
    description: 'Thank gift card buyers and help with delivery.',
    category: 'acquisition',
    triggerType: 'order_placed',
    triggerDescription: 'When a gift card is purchased',
    estimatedDuration: '2 days',
    previewSteps: [
        'Gift card purchase trigger',
        'Send confirmation + delivery options',
        'Wait 1 day',
        'Send reminder if undelivered',
    ],
    definition: {
        startNodeId: 'trigger-1',
        nodes: [
            {
                id: 'trigger-1',
                type: 'trigger',
                position: { x: NODE_START_X, y: NODE_START_Y },
                data: {
                    label: 'Gift Card Purchased',
                    config: { triggerType: 'order_placed' },
                },
            },
            {
                id: 'email-1',
                type: 'send_email',
                position: { x: NODE_START_X, y: NODE_START_Y + NODE_VERTICAL_SPACING },
                data: {
                    label: 'Gift Card Confirmation',
                    config: {
                        subject: '🎁 {{name}}, your gift card is ready!',
                        body: 'Hi {{name}},\n\nThank you for purchasing a gift card!\n\n💳 Gift Card Value: [Amount]\n📧 Recipient: [Recipient]\n📅 Delivery Date: [Date]\n\n[Schedule Delivery]\n[Send Now]\n\nNeed to make changes? You can update delivery details anytime.\n\nBest,\nThe Team',
                        preheader: 'Your gift card purchase is confirmed',
                    },
                },
            },
            {
                id: 'exit-1',
                type: 'exit_flow',
                position: { x: NODE_START_X, y: NODE_START_Y + NODE_VERTICAL_SPACING * 2 },
                data: {
                    label: 'Exit Flow',
                    config: { reason: 'Gift card flow completed' },
                },
            },
        ],
        edges: [
            { id: 'e0', source: 'trigger-1', target: 'email-1' },
            { id: 'e1', source: 'email-1', target: 'exit-1' },
        ],
    },
};
const subscriptionRenewalTemplate = {
    id: 'subscription-renewal',
    name: 'Subscription Renewal',
    description: 'Notify customers about upcoming subscription renewals and offer options.',
    category: 'retention',
    triggerType: 'custom_event',
    triggerDescription: 'When renewal date approaches',
    estimatedDuration: '7 days',
    previewSteps: [
        'Renewal approaching trigger',
        'Send renewal notice',
        'Wait 5 days',
        'Send final reminder',
    ],
    definition: {
        startNodeId: 'trigger-1',
        nodes: [
            {
                id: 'trigger-1',
                type: 'trigger',
                position: { x: NODE_START_X, y: NODE_START_Y },
                data: {
                    label: 'Renewal Approaching',
                    config: { triggerType: 'custom_event', eventName: 'renewal_approaching' },
                },
            },
            {
                id: 'email-1',
                type: 'send_email',
                position: { x: NODE_START_X, y: NODE_START_Y + NODE_VERTICAL_SPACING },
                data: {
                    label: 'Renewal Notice',
                    config: {
                        subject: '🔄 {{name}}, your subscription renews soon',
                        body: 'Hi {{name}},\n\nYour subscription will automatically renew in 7 days.\n\n📅 Renewal Date: [Date]\n💳 Amount: [Amount]\n📦 Plan: [Plan Name]\n\nNo action needed to continue. Want to make changes?\n\n[Update Payment Method]\n[Change Plan]\n[Cancel Subscription]\n\nBest,\nThe Team',
                        preheader: 'Your subscription renews soon',
                    },
                },
            },
            {
                id: 'wait-1',
                type: 'wait',
                position: { x: NODE_START_X, y: NODE_START_Y + NODE_VERTICAL_SPACING * 2 },
                data: {
                    label: 'Wait 5 days',
                    config: { delay: 432000, unit: 'days' },
                },
            },
            {
                id: 'email-2',
                type: 'send_email',
                position: { x: NODE_START_X, y: NODE_START_Y + NODE_VERTICAL_SPACING * 3 },
                data: {
                    label: 'Final Reminder',
                    config: {
                        subject: '⏰ {{name}}, renewal in 2 days',
                        body: 'Hi {{name}},\n\nJust a reminder - your subscription renews in 2 days.\n\nMake sure your payment method is up to date to avoid interruption.\n\n[Review Subscription]\n\nBest,\nThe Team',
                        preheader: 'Final renewal reminder',
                    },
                },
            },
            {
                id: 'exit-1',
                type: 'exit_flow',
                position: { x: NODE_START_X, y: NODE_START_Y + NODE_VERTICAL_SPACING * 4 },
                data: {
                    label: 'Exit Flow',
                    config: { reason: 'Renewal flow completed' },
                },
            },
        ],
        edges: [
            { id: 'e0', source: 'trigger-1', target: 'email-1' },
            { id: 'e1', source: 'email-1', target: 'wait-1' },
            { id: 'e2', source: 'wait-1', target: 'email-2' },
            { id: 'e3', source: 'email-2', target: 'exit-1' },
        ],
    },
};
const productUsageTipsTemplate = {
    id: 'product-usage-tips',
    name: 'Product Usage Tips',
    description: 'Send helpful tips and tutorials based on customer activity.',
    category: 'retention',
    triggerType: 'order_fulfilled',
    triggerDescription: 'After product delivery',
    estimatedDuration: '14 days',
    previewSteps: [
        'Product delivered trigger',
        'Wait 3 days',
        'Send usage tips',
        'Wait 7 days',
        'Send advanced tips',
    ],
    definition: {
        startNodeId: 'trigger-1',
        nodes: [
            {
                id: 'trigger-1',
                type: 'trigger',
                position: { x: NODE_START_X, y: NODE_START_Y },
                data: {
                    label: 'Product Delivered',
                    config: { triggerType: 'order_fulfilled' },
                },
            },
            {
                id: 'wait-1',
                type: 'wait',
                position: { x: NODE_START_X, y: NODE_START_Y + NODE_VERTICAL_SPACING },
                data: {
                    label: 'Wait 3 days',
                    config: { delay: 259200, unit: 'days' },
                },
            },
            {
                id: 'email-1',
                type: 'send_email',
                position: { x: NODE_START_X, y: NODE_START_Y + NODE_VERTICAL_SPACING * 2 },
                data: {
                    label: 'Usage Tips',
                    config: {
                        subject: '💡 {{name}}, get the most from your {{productName}}',
                        body: "Hi {{name}},\n\nNow that you've had time with your {{productName}}, here are some tips:\n\n🔹 Tip 1: [First tip]\n🔹 Tip 2: [Second tip]\n🔹 Tip 3: [Third tip]\n\n[Watch Tutorial Video]\n\nBest,\nThe Team",
                        preheader: 'Pro tips for your purchase',
                    },
                },
            },
            {
                id: 'wait-2',
                type: 'wait',
                position: { x: NODE_START_X, y: NODE_START_Y + NODE_VERTICAL_SPACING * 3 },
                data: {
                    label: 'Wait 7 days',
                    config: { delay: 604800, unit: 'days' },
                },
            },
            {
                id: 'email-2',
                type: 'send_email',
                position: { x: NODE_START_X, y: NODE_START_Y + NODE_VERTICAL_SPACING * 4 },
                data: {
                    label: 'Advanced Tips',
                    config: {
                        subject: '🚀 {{name}}, level up with these advanced tips',
                        body: 'Hi {{name}},\n\nReady to become a pro? Here are advanced tips:\n\n⭐ Advanced tip 1\n⭐ Advanced tip 2\n⭐ Advanced tip 3\n\n[See All Tips & Tricks]\n\nBest,\nThe Team',
                        preheader: 'Advanced tips for power users',
                    },
                },
            },
            {
                id: 'exit-1',
                type: 'exit_flow',
                position: { x: NODE_START_X, y: NODE_START_Y + NODE_VERTICAL_SPACING * 5 },
                data: {
                    label: 'Exit Flow',
                    config: { reason: 'Usage tips completed' },
                },
            },
        ],
        edges: [
            { id: 'e0', source: 'trigger-1', target: 'wait-1' },
            { id: 'e1', source: 'wait-1', target: 'email-1' },
            { id: 'e2', source: 'email-1', target: 'wait-2' },
            { id: 'e3', source: 'wait-2', target: 'email-2' },
            { id: 'e4', source: 'email-2', target: 'exit-1' },
        ],
    },
};
const customerSuccessCheckInTemplate = {
    id: 'customer-success-check-in',
    name: 'Customer Success Check-In',
    description: 'Proactive check-ins to ensure customers are successful.',
    category: 'retention',
    triggerType: 'order_placed',
    triggerDescription: 'After significant purchase',
    estimatedDuration: '30 days',
    previewSteps: [
        'Purchase trigger',
        'Wait 14 days',
        'Send check-in email',
        'Wait 14 days',
        'Send satisfaction survey',
    ],
    definition: {
        startNodeId: 'trigger-1',
        nodes: [
            {
                id: 'trigger-1',
                type: 'trigger',
                position: { x: NODE_START_X, y: NODE_START_Y },
                data: {
                    label: 'Purchase Completed',
                    config: { triggerType: 'order_placed' },
                },
            },
            {
                id: 'wait-1',
                type: 'wait',
                position: { x: NODE_START_X, y: NODE_START_Y + NODE_VERTICAL_SPACING },
                data: {
                    label: 'Wait 14 days',
                    config: { delay: 1209600, unit: 'days' },
                },
            },
            {
                id: 'email-1',
                type: 'send_email',
                position: { x: NODE_START_X, y: NODE_START_Y + NODE_VERTICAL_SPACING * 2 },
                data: {
                    label: 'Check-In Email',
                    config: {
                        subject: '👋 {{name}}, how is everything going?',
                        body: 'Hi {{name}},\n\nI wanted to check in and see how things are going!\n\nAre you getting value from your purchase? Is there anything we can help with?\n\nCommon resources:\n📚 [Help Center]\n💬 [Contact Support]\n📹 [Video Tutorials]\n\nJust reply to this email if you need anything!\n\nBest,\n[Name]\nCustomer Success',
                        preheader: "Let's make sure you're successful",
                    },
                },
            },
            {
                id: 'wait-2',
                type: 'wait',
                position: { x: NODE_START_X, y: NODE_START_Y + NODE_VERTICAL_SPACING * 3 },
                data: {
                    label: 'Wait 14 days',
                    config: { delay: 1209600, unit: 'days' },
                },
            },
            {
                id: 'email-2',
                type: 'send_email',
                position: { x: NODE_START_X, y: NODE_START_Y + NODE_VERTICAL_SPACING * 4 },
                data: {
                    label: 'Satisfaction Survey',
                    config: {
                        subject: '📊 {{name}}, quick question for you',
                        body: "Hi {{name}},\n\nWe'd love your feedback! It takes just 2 minutes.\n\nHow satisfied are you with your experience?\n\n⭐⭐⭐⭐⭐ [Very Satisfied]\n⭐⭐⭐ [Satisfied]\n⭐ [Not Satisfied]\n\nYour feedback helps us improve.\n\nBest,\nThe Team",
                        preheader: 'Quick 2-minute survey',
                    },
                },
            },
            {
                id: 'exit-1',
                type: 'exit_flow',
                position: { x: NODE_START_X, y: NODE_START_Y + NODE_VERTICAL_SPACING * 5 },
                data: {
                    label: 'Exit Flow',
                    config: { reason: 'Check-in completed' },
                },
            },
        ],
        edges: [
            { id: 'e0', source: 'trigger-1', target: 'wait-1' },
            { id: 'e1', source: 'wait-1', target: 'email-1' },
            { id: 'e2', source: 'email-1', target: 'wait-2' },
            { id: 'e3', source: 'wait-2', target: 'email-2' },
            { id: 'e4', source: 'email-2', target: 'exit-1' },
        ],
    },
};
const upgradeSequenceTemplate = {
    id: 'upgrade-sequence',
    name: 'Upgrade Sequence',
    description: 'Guide customers toward upgrading their plan or product tier.',
    category: 'retention',
    triggerType: 'custom_event',
    triggerDescription: 'When customer hits usage limits',
    estimatedDuration: '7 days',
    previewSteps: [
        'Usage limit trigger',
        'Send upgrade benefits email',
        'Wait 3 days',
        'Send limited-time offer',
    ],
    definition: {
        startNodeId: 'trigger-1',
        nodes: [
            {
                id: 'trigger-1',
                type: 'trigger',
                position: { x: NODE_START_X, y: NODE_START_Y },
                data: {
                    label: 'Usage Limit Hit',
                    config: { triggerType: 'custom_event', eventName: 'usage_limit_reached' },
                },
            },
            {
                id: 'email-1',
                type: 'send_email',
                position: { x: NODE_START_X, y: NODE_START_Y + NODE_VERTICAL_SPACING },
                data: {
                    label: 'Upgrade Benefits',
                    config: {
                        subject: '📈 {{name}}, unlock more with an upgrade',
                        body: "Hi {{name}},\n\nLooks like you're getting great value from us! You've reached your current plan limits.\n\nUpgrade to unlock:\n✨ [Benefit 1]\n✨ [Benefit 2]\n✨ [Benefit 3]\n✨ Unlimited [Feature]\n\n[Compare Plans]\n\nBest,\nThe Team",
                        preheader: 'Unlock more features',
                    },
                },
            },
            {
                id: 'wait-1',
                type: 'wait',
                position: { x: NODE_START_X, y: NODE_START_Y + NODE_VERTICAL_SPACING * 2 },
                data: {
                    label: 'Wait 3 days',
                    config: { delay: 259200, unit: 'days' },
                },
            },
            {
                id: 'email-2',
                type: 'send_email',
                position: { x: NODE_START_X, y: NODE_START_Y + NODE_VERTICAL_SPACING * 3 },
                data: {
                    label: 'Limited Offer',
                    config: {
                        subject: '⚡ {{name}}, special upgrade offer expires soon',
                        body: 'Hi {{name}},\n\nFor the next 48 hours, upgrade and get:\n\n🎁 20% off for life\n🎁 Free migration support\n🎁 Priority onboarding\n\n[Upgrade Now - 20% Off]\n\nOffer expires: [Date]\n\nBest,\nThe Team',
                        preheader: 'Limited time: 20% off upgrade',
                    },
                },
            },
            {
                id: 'exit-1',
                type: 'exit_flow',
                position: { x: NODE_START_X, y: NODE_START_Y + NODE_VERTICAL_SPACING * 4 },
                data: {
                    label: 'Exit Flow',
                    config: { reason: 'Upgrade sequence completed' },
                },
            },
        ],
        edges: [
            { id: 'e0', source: 'trigger-1', target: 'email-1' },
            { id: 'e1', source: 'email-1', target: 'wait-1' },
            { id: 'e2', source: 'wait-1', target: 'email-2' },
            { id: 'e3', source: 'email-2', target: 'exit-1' },
        ],
    },
};
const profileCompletionTemplate = {
    id: 'profile-completion',
    name: 'Profile Completion',
    description: 'Encourage customers to complete their profile for better experience.',
    category: 'retention',
    triggerType: 'customer_joined_list',
    triggerDescription: 'When profile is incomplete',
    estimatedDuration: '7 days',
    previewSteps: [
        'Incomplete profile trigger',
        'Wait 1 day',
        'Send completion reminder',
        'Wait 3 days',
        'Send benefits of completion',
    ],
    definition: {
        startNodeId: 'trigger-1',
        nodes: [
            {
                id: 'trigger-1',
                type: 'trigger',
                position: { x: NODE_START_X, y: NODE_START_Y },
                data: {
                    label: 'Profile Incomplete',
                    config: { triggerType: 'customer_joined_list' },
                },
            },
            {
                id: 'wait-1',
                type: 'wait',
                position: { x: NODE_START_X, y: NODE_START_Y + NODE_VERTICAL_SPACING },
                data: {
                    label: 'Wait 1 day',
                    config: { delay: 86400, unit: 'days' },
                },
            },
            {
                id: 'email-1',
                type: 'send_email',
                position: { x: NODE_START_X, y: NODE_START_Y + NODE_VERTICAL_SPACING * 2 },
                data: {
                    label: 'Completion Reminder',
                    config: {
                        subject: '✏️ {{name}}, complete your profile',
                        body: 'Hi {{name}},\n\nYour profile is almost complete!\n\nComplete your profile to:\n📍 Get personalized recommendations\n🎁 Unlock exclusive offers\n⚡ Faster checkout\n\n[Complete Profile]\n\nIt only takes 2 minutes!\n\nBest,\nThe Team',
                        preheader: 'Unlock personalized features',
                    },
                },
            },
            {
                id: 'wait-2',
                type: 'wait',
                position: { x: NODE_START_X, y: NODE_START_Y + NODE_VERTICAL_SPACING * 3 },
                data: {
                    label: 'Wait 3 days',
                    config: { delay: 259200, unit: 'days' },
                },
            },
            {
                id: 'email-2',
                type: 'send_email',
                position: { x: NODE_START_X, y: NODE_START_Y + NODE_VERTICAL_SPACING * 4 },
                data: {
                    label: 'Benefits Email',
                    config: {
                        subject: '🎯 {{name}}, see what you are missing',
                        body: 'Hi {{name}},\n\nMembers with complete profiles get:\n\n• 30% more relevant recommendations\n• Exclusive member discounts\n• Priority support\n• Birthday surprises\n\n[Complete Your Profile Now]\n\nBest,\nThe Team',
                        preheader: 'Benefits of a complete profile',
                    },
                },
            },
            {
                id: 'exit-1',
                type: 'exit_flow',
                position: { x: NODE_START_X, y: NODE_START_Y + NODE_VERTICAL_SPACING * 5 },
                data: {
                    label: 'Exit Flow',
                    config: { reason: 'Profile completion flow ended' },
                },
            },
        ],
        edges: [
            { id: 'e0', source: 'trigger-1', target: 'wait-1' },
            { id: 'e1', source: 'wait-1', target: 'email-1' },
            { id: 'e2', source: 'email-1', target: 'wait-2' },
            { id: 'e3', source: 'wait-2', target: 'email-2' },
            { id: 'e4', source: 'email-2', target: 'exit-1' },
        ],
    },
};
const anniversaryTemplate = {
    id: 'anniversary',
    name: 'Anniversary Celebration',
    description: 'Celebrate customer anniversaries with special recognition.',
    category: 'retention',
    triggerType: 'custom_event',
    triggerDescription: 'On customer anniversary date',
    estimatedDuration: '1 day',
    previewSteps: ['Anniversary trigger', 'Send anniversary celebration email'],
    definition: {
        startNodeId: 'trigger-1',
        nodes: [
            {
                id: 'trigger-1',
                type: 'trigger',
                position: { x: NODE_START_X, y: NODE_START_Y },
                data: {
                    label: 'Anniversary Date',
                    config: { triggerType: 'custom_event', eventName: 'customer_anniversary' },
                },
            },
            {
                id: 'email-1',
                type: 'send_email',
                position: { x: NODE_START_X, y: NODE_START_Y + NODE_VERTICAL_SPACING },
                data: {
                    label: 'Anniversary Email',
                    config: {
                        subject: "🎉 {{name}}, it's your anniversary with us!",
                        body: "Hi {{name}},\n\nCan you believe it's been [X] year(s)?!\n\n🎊 Thank you for being part of our journey!\n\nYour stats:\n📦 [X] orders placed\n💰 $[X] saved with us\n⭐ Member since [Date]\n\nAs a thank you, here's a special gift:\n\n🎁 [Anniversary Offer]\n\n[Claim Your Gift]\n\nHere's to many more years together!\n\nBest,\nThe Team",
                        preheader: 'Happy anniversary! A gift awaits',
                    },
                },
            },
            {
                id: 'exit-1',
                type: 'exit_flow',
                position: { x: NODE_START_X, y: NODE_START_Y + NODE_VERTICAL_SPACING * 2 },
                data: {
                    label: 'Exit Flow',
                    config: { reason: 'Anniversary celebrated' },
                },
            },
        ],
        edges: [
            { id: 'e0', source: 'trigger-1', target: 'email-1' },
            { id: 'e1', source: 'email-1', target: 'exit-1' },
        ],
    },
};
const quantityBreakTemplate = {
    id: 'quantity-break',
    name: 'Bulk Order Discount',
    description: 'Encourage bulk purchases with quantity discounts.',
    category: 'retention',
    triggerType: 'order_placed',
    triggerDescription: 'After multiple small orders',
    estimatedDuration: '3 days',
    previewSteps: ['Order trigger', 'Check order history', 'Send bulk discount offer'],
    definition: {
        startNodeId: 'trigger-1',
        nodes: [
            {
                id: 'trigger-1',
                type: 'trigger',
                position: { x: NODE_START_X, y: NODE_START_Y },
                data: {
                    label: 'Order Placed',
                    config: { triggerType: 'order_placed' },
                },
            },
            {
                id: 'conditional-1',
                type: 'conditional_split',
                position: { x: NODE_START_X, y: NODE_START_Y + NODE_VERTICAL_SPACING },
                data: {
                    label: 'Check Order Frequency',
                    config: { condition: 'orders_last_30_days >= 3' },
                },
            },
            {
                id: 'email-1',
                type: 'send_email',
                position: { x: NODE_START_X - 150, y: NODE_START_Y + NODE_VERTICAL_SPACING * 2 },
                data: {
                    label: 'Bulk Discount Offer',
                    config: {
                        subject: '📦 {{name}}, save more when you buy more',
                        body: 'Hi {{name}},\n\nWe noticed you love [Product Category]!\n\nSave big with bulk orders:\n\n🏷️ Buy 3, save 10%\n🏷️ Buy 5, save 15%\n🏷️ Buy 10+, save 25%\n\n[Shop Bulk Deals]\n\nPerfect for stocking up!\n\nBest,\nThe Team',
                        preheader: 'Buy more, save more',
                    },
                },
            },
            {
                id: 'exit-1',
                type: 'exit_flow',
                position: { x: NODE_START_X, y: NODE_START_Y + NODE_VERTICAL_SPACING * 3 },
                data: {
                    label: 'Exit Flow',
                    config: { reason: 'Bulk offer flow completed' },
                },
            },
        ],
        edges: [
            { id: 'e0', source: 'trigger-1', target: 'conditional-1' },
            {
                id: 'e1',
                source: 'conditional-1',
                target: 'email-1',
                sourceHandle: 'yes',
                label: 'Frequent buyer',
            },
            {
                id: 'e2',
                source: 'conditional-1',
                target: 'exit-1',
                sourceHandle: 'no',
                label: 'Not frequent',
            },
            { id: 'e3', source: 'email-1', target: 'exit-1' },
        ],
    },
};
const featureAnnouncementTemplate = {
    id: 'feature-announcement',
    name: 'Feature Announcement',
    description: 'Announce new features or product updates to customers.',
    category: 'engagement',
    triggerType: 'custom_event',
    triggerDescription: 'When new feature launches',
    estimatedDuration: '3 days',
    previewSteps: [
        'Feature launch trigger',
        'Send announcement',
        'Wait 2 days',
        'Send follow-up with tips',
    ],
    definition: {
        startNodeId: 'trigger-1',
        nodes: [
            {
                id: 'trigger-1',
                type: 'trigger',
                position: { x: NODE_START_X, y: NODE_START_Y },
                data: {
                    label: 'Feature Launched',
                    config: { triggerType: 'custom_event', eventName: 'feature_launched' },
                },
            },
            {
                id: 'email-1',
                type: 'send_email',
                position: { x: NODE_START_X, y: NODE_START_Y + NODE_VERTICAL_SPACING },
                data: {
                    label: 'Feature Announcement',
                    config: {
                        subject: '🆕 {{name}}, introducing [Feature Name]!',
                        body: "Hi {{name}},\n\nExciting news! We just launched [Feature Name].\n\n✨ What it does:\n[Feature description]\n\n✨ Why you'll love it:\n• Benefit 1\n• Benefit 2\n• Benefit 3\n\n[Try It Now]\n\nBest,\nThe Team",
                        preheader: 'New feature just launched!',
                    },
                },
            },
            {
                id: 'wait-1',
                type: 'wait',
                position: { x: NODE_START_X, y: NODE_START_Y + NODE_VERTICAL_SPACING * 2 },
                data: {
                    label: 'Wait 2 days',
                    config: { delay: 172800, unit: 'days' },
                },
            },
            {
                id: 'email-2',
                type: 'send_email',
                position: { x: NODE_START_X, y: NODE_START_Y + NODE_VERTICAL_SPACING * 3 },
                data: {
                    label: 'Feature Tips',
                    config: {
                        subject: '💡 Pro tips for [Feature Name]',
                        body: 'Hi {{name}},\n\nHere are some tips to get the most out of [Feature Name]:\n\n🔹 Tip 1: [Description]\n🔹 Tip 2: [Description]\n🔹 Tip 3: [Description]\n\n[Watch Tutorial]\n\nBest,\nThe Team',
                        preheader: 'Get the most from our new feature',
                    },
                },
            },
            {
                id: 'exit-1',
                type: 'exit_flow',
                position: { x: NODE_START_X, y: NODE_START_Y + NODE_VERTICAL_SPACING * 4 },
                data: {
                    label: 'Exit Flow',
                    config: { reason: 'Feature announcement completed' },
                },
            },
        ],
        edges: [
            { id: 'e0', source: 'trigger-1', target: 'email-1' },
            { id: 'e1', source: 'email-1', target: 'wait-1' },
            { id: 'e2', source: 'wait-1', target: 'email-2' },
            { id: 'e3', source: 'email-2', target: 'exit-1' },
        ],
    },
};
const communityEngagementTemplate = {
    id: 'community-engagement',
    name: 'Community Engagement',
    description: 'Invite customers to join your community for better engagement.',
    category: 'engagement',
    triggerType: 'order_placed',
    triggerDescription: 'After purchase',
    estimatedDuration: '7 days',
    previewSteps: ['Purchase trigger', 'Wait 3 days', 'Send community invitation'],
    definition: {
        startNodeId: 'trigger-1',
        nodes: [
            {
                id: 'trigger-1',
                type: 'trigger',
                position: { x: NODE_START_X, y: NODE_START_Y },
                data: {
                    label: 'Purchase Made',
                    config: { triggerType: 'order_placed' },
                },
            },
            {
                id: 'wait-1',
                type: 'wait',
                position: { x: NODE_START_X, y: NODE_START_Y + NODE_VERTICAL_SPACING },
                data: {
                    label: 'Wait 3 days',
                    config: { delay: 259200, unit: 'days' },
                },
            },
            {
                id: 'email-1',
                type: 'send_email',
                position: { x: NODE_START_X, y: NODE_START_Y + NODE_VERTICAL_SPACING * 2 },
                data: {
                    label: 'Community Invitation',
                    config: {
                        subject: '👥 {{name}}, join our community!',
                        body: "Hi {{name}},\n\nYou're officially part of the family! Join our community to:\n\n🗣️ Connect with other customers\n💡 Share tips and tricks\n🎁 Get exclusive community deals\n📣 Be first to know about updates\n\n[Join Discord]\n[Join Facebook Group]\n[Join Slack]\n\nSee you inside!\n\nBest,\nThe Team",
                        preheader: 'Join thousands of customers in our community',
                    },
                },
            },
            {
                id: 'exit-1',
                type: 'exit_flow',
                position: { x: NODE_START_X, y: NODE_START_Y + NODE_VERTICAL_SPACING * 3 },
                data: {
                    label: 'Exit Flow',
                    config: { reason: 'Community invitation sent' },
                },
            },
        ],
        edges: [
            { id: 'e0', source: 'trigger-1', target: 'wait-1' },
            { id: 'e1', source: 'wait-1', target: 'email-1' },
            { id: 'e2', source: 'email-1', target: 'exit-1' },
        ],
    },
};
const ugcRequestTemplate = {
    id: 'ugc-request',
    name: 'UGC Request',
    description: 'Request user-generated content like photos and testimonials.',
    category: 'engagement',
    triggerType: 'order_fulfilled',
    triggerDescription: 'After order delivery',
    estimatedDuration: '10 days',
    previewSteps: ['Delivery trigger', 'Wait 7 days', 'Send UGC request'],
    definition: {
        startNodeId: 'trigger-1',
        nodes: [
            {
                id: 'trigger-1',
                type: 'trigger',
                position: { x: NODE_START_X, y: NODE_START_Y },
                data: {
                    label: 'Order Delivered',
                    config: { triggerType: 'order_fulfilled' },
                },
            },
            {
                id: 'wait-1',
                type: 'wait',
                position: { x: NODE_START_X, y: NODE_START_Y + NODE_VERTICAL_SPACING },
                data: {
                    label: 'Wait 7 days',
                    config: { delay: 604800, unit: 'days' },
                },
            },
            {
                id: 'email-1',
                type: 'send_email',
                position: { x: NODE_START_X, y: NODE_START_Y + NODE_VERTICAL_SPACING * 2 },
                data: {
                    label: 'UGC Request',
                    config: {
                        subject: '📸 {{name}}, share your experience!',
                        body: "Hi {{name}},\n\nWe'd love to see your {{productName}} in action!\n\nShare a photo or video and:\n🎁 Get 15% off your next order\n⭐ Be featured on our page\n🏆 Enter to win monthly prizes\n\n[Upload Your Content]\n\nUse hashtag #[YourBrand]\n\nBest,\nThe Team",
                        preheader: 'Share your experience and get rewarded',
                    },
                },
            },
            {
                id: 'exit-1',
                type: 'exit_flow',
                position: { x: NODE_START_X, y: NODE_START_Y + NODE_VERTICAL_SPACING * 3 },
                data: {
                    label: 'Exit Flow',
                    config: { reason: 'UGC request sent' },
                },
            },
        ],
        edges: [
            { id: 'e0', source: 'trigger-1', target: 'wait-1' },
            { id: 'e1', source: 'wait-1', target: 'email-1' },
            { id: 'e2', source: 'email-1', target: 'exit-1' },
        ],
    },
};
const contestEntryTemplate = {
    id: 'contest-entry',
    name: 'Contest Entry',
    description: 'Promote contests and giveaways to increase engagement.',
    category: 'engagement',
    triggerType: 'custom_event',
    triggerDescription: 'When contest launches',
    estimatedDuration: '14 days',
    previewSteps: [
        'Contest launch trigger',
        'Send contest announcement',
        'Wait 7 days',
        'Send reminder',
        'Wait 5 days',
        'Send last chance',
    ],
    definition: {
        startNodeId: 'trigger-1',
        nodes: [
            {
                id: 'trigger-1',
                type: 'trigger',
                position: { x: NODE_START_X, y: NODE_START_Y },
                data: {
                    label: 'Contest Launched',
                    config: { triggerType: 'custom_event', eventName: 'contest_launched' },
                },
            },
            {
                id: 'email-1',
                type: 'send_email',
                position: { x: NODE_START_X, y: NODE_START_Y + NODE_VERTICAL_SPACING },
                data: {
                    label: 'Contest Announcement',
                    config: {
                        subject: '🏆 {{name}}, win [Prize]!',
                        body: "Hi {{name}},\n\nWe're giving away [Prize]!\n\n🎁 Prize: [Description]\n📅 Ends: [Date]\n✅ How to enter:\n1. [Step 1]\n2. [Step 2]\n3. [Step 3]\n\n[Enter Now]\n\nGood luck!\n\nBest,\nThe Team",
                        preheader: 'Enter to win!',
                    },
                },
            },
            {
                id: 'wait-1',
                type: 'wait',
                position: { x: NODE_START_X, y: NODE_START_Y + NODE_VERTICAL_SPACING * 2 },
                data: {
                    label: 'Wait 7 days',
                    config: { delay: 604800, unit: 'days' },
                },
            },
            {
                id: 'email-2',
                type: 'send_email',
                position: { x: NODE_START_X, y: NODE_START_Y + NODE_VERTICAL_SPACING * 3 },
                data: {
                    label: 'Contest Reminder',
                    config: {
                        subject: '⏰ {{name}}, contest ends in 1 week!',
                        body: "Hi {{name}},\n\nHave you entered yet?\n\n[X] entries so far - your odds are great!\n\n[Enter Now]\n\nDon't miss out!\n\nBest,\nThe Team",
                        preheader: 'Contest reminder - 1 week left',
                    },
                },
            },
            {
                id: 'wait-2',
                type: 'wait',
                position: { x: NODE_START_X, y: NODE_START_Y + NODE_VERTICAL_SPACING * 4 },
                data: {
                    label: 'Wait 5 days',
                    config: { delay: 432000, unit: 'days' },
                },
            },
            {
                id: 'email-3',
                type: 'send_email',
                position: { x: NODE_START_X, y: NODE_START_Y + NODE_VERTICAL_SPACING * 5 },
                data: {
                    label: 'Last Chance',
                    config: {
                        subject: '🚨 LAST CHANCE: Contest ends tomorrow!',
                        body: 'Hi {{name}},\n\nFinal reminder - contest ends TOMORROW!\n\n🏆 Prize: [Prize]\n⏰ Deadline: [Date/Time]\n\n[Enter Before It Is Too Late]\n\nBest,\nThe Team',
                        preheader: 'Last chance to enter!',
                    },
                },
            },
            {
                id: 'exit-1',
                type: 'exit_flow',
                position: { x: NODE_START_X, y: NODE_START_Y + NODE_VERTICAL_SPACING * 6 },
                data: {
                    label: 'Exit Flow',
                    config: { reason: 'Contest promotion completed' },
                },
            },
        ],
        edges: [
            { id: 'e0', source: 'trigger-1', target: 'email-1' },
            { id: 'e1', source: 'email-1', target: 'wait-1' },
            { id: 'e2', source: 'wait-1', target: 'email-2' },
            { id: 'e3', source: 'email-2', target: 'wait-2' },
            { id: 'e4', source: 'wait-2', target: 'email-3' },
            { id: 'e5', source: 'email-3', target: 'exit-1' },
        ],
    },
};
const deliveryConfirmationTemplate = {
    id: 'delivery-confirmation',
    name: 'Delivery Confirmation',
    description: 'Confirm delivery and gather immediate feedback.',
    category: 'engagement',
    triggerType: 'order_fulfilled',
    triggerDescription: 'When delivery confirmed',
    estimatedDuration: '1 day',
    previewSteps: ['Delivery confirmed trigger', 'Send confirmation + feedback request'],
    definition: {
        startNodeId: 'trigger-1',
        nodes: [
            {
                id: 'trigger-1',
                type: 'trigger',
                position: { x: NODE_START_X, y: NODE_START_Y },
                data: {
                    label: 'Delivery Confirmed',
                    config: { triggerType: 'order_fulfilled' },
                },
            },
            {
                id: 'email-1',
                type: 'send_email',
                position: { x: NODE_START_X, y: NODE_START_Y + NODE_VERTICAL_SPACING },
                data: {
                    label: 'Delivery Confirmation',
                    config: {
                        subject: '✅ {{name}}, your package has been delivered!',
                        body: 'Hi {{name}},\n\nGreat news - your package has been delivered!\n\n📦 Order #[Order Number]\n📍 Delivered to: [Address]\n📅 Date: [Date]\n\nEverything look good?\n\n👍 [Yes, looks great!]\n👎 [There is an issue]\n\nBest,\nThe Team',
                        preheader: 'Your order has arrived!',
                    },
                },
            },
            {
                id: 'exit-1',
                type: 'exit_flow',
                position: { x: NODE_START_X, y: NODE_START_Y + NODE_VERTICAL_SPACING * 2 },
                data: {
                    label: 'Exit Flow',
                    config: { reason: 'Delivery confirmed' },
                },
            },
        ],
        edges: [
            { id: 'e0', source: 'trigger-1', target: 'email-1' },
            { id: 'e1', source: 'email-1', target: 'exit-1' },
        ],
    },
};
const refundProcessedTemplate = {
    id: 'refund-processed',
    name: 'Refund Processed',
    description: 'Notify customers when their refund has been processed.',
    category: 'engagement',
    triggerType: 'custom_event',
    triggerDescription: 'When refund is processed',
    estimatedDuration: '1 day',
    previewSteps: ['Refund processed trigger', 'Send refund confirmation'],
    definition: {
        startNodeId: 'trigger-1',
        nodes: [
            {
                id: 'trigger-1',
                type: 'trigger',
                position: { x: NODE_START_X, y: NODE_START_Y },
                data: {
                    label: 'Refund Processed',
                    config: { triggerType: 'custom_event', eventName: 'refund_processed' },
                },
            },
            {
                id: 'email-1',
                type: 'send_email',
                position: { x: NODE_START_X, y: NODE_START_Y + NODE_VERTICAL_SPACING },
                data: {
                    label: 'Refund Confirmation',
                    config: {
                        subject: '💰 {{name}}, your refund has been processed',
                        body: "Hi {{name}},\n\nYour refund has been processed.\n\n💳 Amount: [Amount]\n📦 Order: #[Order Number]\n🏦 Method: [Payment Method]\n⏰ Processing time: 3-5 business days\n\nWe're sorry it didn't work out. We'd love to have you back!\n\n[Browse New Arrivals]\n\nBest,\nThe Team",
                        preheader: 'Your refund is on its way',
                    },
                },
            },
            {
                id: 'exit-1',
                type: 'exit_flow',
                position: { x: NODE_START_X, y: NODE_START_Y + NODE_VERTICAL_SPACING * 2 },
                data: {
                    label: 'Exit Flow',
                    config: { reason: 'Refund notification sent' },
                },
            },
        ],
        edges: [
            { id: 'e0', source: 'trigger-1', target: 'email-1' },
            { id: 'e1', source: 'email-1', target: 'exit-1' },
        ],
    },
};
const subscriptionPauseTemplate = {
    id: 'subscription-pause',
    name: 'Subscription Pause',
    description: 'Handle pause requests and offer alternatives to keep customers.',
    category: 'engagement',
    triggerType: 'custom_event',
    triggerDescription: 'When subscription paused',
    estimatedDuration: '7 days',
    previewSteps: ['Pause trigger', 'Send pause confirmation', 'Wait 5 days', 'Send check-in'],
    definition: {
        startNodeId: 'trigger-1',
        nodes: [
            {
                id: 'trigger-1',
                type: 'trigger',
                position: { x: NODE_START_X, y: NODE_START_Y },
                data: {
                    label: 'Subscription Paused',
                    config: { triggerType: 'custom_event', eventName: 'subscription_paused' },
                },
            },
            {
                id: 'email-1',
                type: 'send_email',
                position: { x: NODE_START_X, y: NODE_START_Y + NODE_VERTICAL_SPACING },
                data: {
                    label: 'Pause Confirmation',
                    config: {
                        subject: '⏸️ {{name}}, your subscription is paused',
                        body: "Hi {{name}},\n\nYour subscription has been paused.\n\n📅 Paused until: [Date]\n💡 You can resume anytime\n\nWhile you are away, here's what you can do:\n• Browse our latest products\n• Update your preferences\n• Adjust your plan\n\n[Resume Subscription]\n[Modify Preferences]\n\nWe'll be here when you're ready!\n\nBest,\nThe Team",
                        preheader: 'Subscription paused - resume anytime',
                    },
                },
            },
            {
                id: 'wait-1',
                type: 'wait',
                position: { x: NODE_START_X, y: NODE_START_Y + NODE_VERTICAL_SPACING * 2 },
                data: {
                    label: 'Wait 5 days',
                    config: { delay: 432000, unit: 'days' },
                },
            },
            {
                id: 'email-2',
                type: 'send_email',
                position: { x: NODE_START_X, y: NODE_START_Y + NODE_VERTICAL_SPACING * 3 },
                data: {
                    label: 'Check-In',
                    config: {
                        subject: '👋 {{name}}, how are things going?',
                        body: "Hi {{name}},\n\nJust checking in!\n\nWe've been working on some great updates while you've been away:\n\n✨ [New Feature/Product 1]\n✨ [New Feature/Product 2]\n\nReady to come back? We'd love to have you!\n\n[Resume with 10% Off]\n\nBest,\nThe Team",
                        preheader: "We've missed you!",
                    },
                },
            },
            {
                id: 'exit-1',
                type: 'exit_flow',
                position: { x: NODE_START_X, y: NODE_START_Y + NODE_VERTICAL_SPACING * 4 },
                data: {
                    label: 'Exit Flow',
                    config: { reason: 'Pause flow completed' },
                },
            },
        ],
        edges: [
            { id: 'e0', source: 'trigger-1', target: 'email-1' },
            { id: 'e1', source: 'email-1', target: 'wait-1' },
            { id: 'e2', source: 'wait-1', target: 'email-2' },
            { id: 'e3', source: 'email-2', target: 'exit-1' },
        ],
    },
};
const returnInitiatedTemplate = {
    id: 'return-initiated',
    name: 'Return Initiated',
    description: 'Guide customers through the return process.',
    category: 'engagement',
    triggerType: 'custom_event',
    triggerDescription: 'When return is initiated',
    estimatedDuration: '5 days',
    previewSteps: [
        'Return initiated trigger',
        'Send return instructions',
        'Wait 3 days',
        'Send return status update',
    ],
    definition: {
        startNodeId: 'trigger-1',
        nodes: [
            {
                id: 'trigger-1',
                type: 'trigger',
                position: { x: NODE_START_X, y: NODE_START_Y },
                data: {
                    label: 'Return Initiated',
                    config: { triggerType: 'custom_event', eventName: 'return_initiated' },
                },
            },
            {
                id: 'email-1',
                type: 'send_email',
                position: { x: NODE_START_X, y: NODE_START_Y + NODE_VERTICAL_SPACING },
                data: {
                    label: 'Return Instructions',
                    config: {
                        subject: '📦 {{name}}, your return is ready',
                        body: 'Hi {{name}},\n\nYour return request has been approved.\n\n📋 Return #: [Return ID]\n📦 Item(s): [Items]\n\nNext steps:\n1. Print the label below\n2. Pack items securely\n3. Drop off at any [Carrier] location\n\n[Print Return Label]\n[Find Drop-off Location]\n\nNeed help? [Contact Support]\n\nBest,\nThe Team',
                        preheader: 'Your return label is ready',
                    },
                },
            },
            {
                id: 'wait-1',
                type: 'wait',
                position: { x: NODE_START_X, y: NODE_START_Y + NODE_VERTICAL_SPACING * 2 },
                data: {
                    label: 'Wait 3 days',
                    config: { delay: 259200, unit: 'days' },
                },
            },
            {
                id: 'email-2',
                type: 'send_email',
                position: { x: NODE_START_X, y: NODE_START_Y + NODE_VERTICAL_SPACING * 3 },
                data: {
                    label: 'Return Reminder',
                    config: {
                        subject: '⏰ {{name}}, return reminder',
                        body: "Hi {{name}},\n\nJust a reminder about your pending return.\n\n📋 Return #: [Return ID]\n📅 Expires: [Date]\n\nDon't forget to ship it back!\n\n[Track Return Status]\n\nBest,\nThe Team",
                        preheader: 'Return reminder',
                    },
                },
            },
            {
                id: 'exit-1',
                type: 'exit_flow',
                position: { x: NODE_START_X, y: NODE_START_Y + NODE_VERTICAL_SPACING * 4 },
                data: {
                    label: 'Exit Flow',
                    config: { reason: 'Return flow completed' },
                },
            },
        ],
        edges: [
            { id: 'e0', source: 'trigger-1', target: 'email-1' },
            { id: 'e1', source: 'email-1', target: 'wait-1' },
            { id: 'e2', source: 'wait-1', target: 'email-2' },
            { id: 'e3', source: 'email-2', target: 'exit-1' },
        ],
    },
};
const wishlistReminderTemplate = {
    id: 'wishlist-reminder',
    name: 'Wishlist Reminder',
    description: 'Remind customers about items saved to their wishlist.',
    category: 'engagement',
    triggerType: 'custom_event',
    triggerDescription: 'When items added to wishlist',
    estimatedDuration: '7 days',
    previewSteps: [
        'Wishlist add trigger',
        'Wait 3 days',
        'Send wishlist reminder',
        'Wait 4 days',
        'Send sale alert',
    ],
    definition: {
        startNodeId: 'trigger-1',
        nodes: [
            {
                id: 'trigger-1',
                type: 'trigger',
                position: { x: NODE_START_X, y: NODE_START_Y },
                data: {
                    label: 'Added to Wishlist',
                    config: { triggerType: 'custom_event', eventName: 'wishlist_add' },
                },
            },
            {
                id: 'wait-1',
                type: 'wait',
                position: { x: NODE_START_X, y: NODE_START_Y + NODE_VERTICAL_SPACING },
                data: {
                    label: 'Wait 3 days',
                    config: { delay: 259200, unit: 'days' },
                },
            },
            {
                id: 'email-1',
                type: 'send_email',
                position: { x: NODE_START_X, y: NODE_START_Y + NODE_VERTICAL_SPACING * 2 },
                data: {
                    label: 'Wishlist Reminder',
                    config: {
                        subject: '❤️ {{name}}, your wishlist is waiting',
                        body: "Hi {{name}},\n\nDon't forget about these items you loved:\n\n[Wishlist Items with Images]\n\nTreat yourself!\n\n[View Wishlist]\n\nBest,\nThe Team",
                        preheader: 'Items you saved are still available',
                    },
                },
            },
            {
                id: 'wait-2',
                type: 'wait',
                position: { x: NODE_START_X, y: NODE_START_Y + NODE_VERTICAL_SPACING * 3 },
                data: {
                    label: 'Wait 4 days',
                    config: { delay: 345600, unit: 'days' },
                },
            },
            {
                id: 'email-2',
                type: 'send_email',
                position: { x: NODE_START_X, y: NODE_START_Y + NODE_VERTICAL_SPACING * 4 },
                data: {
                    label: 'Wishlist Sale Alert',
                    config: {
                        subject: '🔔 {{name}}, your wishlist item is on sale!',
                        body: "Hi {{name}},\n\nGood news! Items from your wishlist are now on sale:\n\n[Sale Items from Wishlist]\n\nGrab them before they're gone!\n\n[Shop Sale Items]\n\nBest,\nThe Team",
                        preheader: 'Your wishlist items are on sale!',
                    },
                },
            },
            {
                id: 'exit-1',
                type: 'exit_flow',
                position: { x: NODE_START_X, y: NODE_START_Y + NODE_VERTICAL_SPACING * 5 },
                data: {
                    label: 'Exit Flow',
                    config: { reason: 'Wishlist reminder completed' },
                },
            },
        ],
        edges: [
            { id: 'e0', source: 'trigger-1', target: 'wait-1' },
            { id: 'e1', source: 'wait-1', target: 'email-1' },
            { id: 'e2', source: 'email-1', target: 'wait-2' },
            { id: 'e3', source: 'wait-2', target: 'email-2' },
            { id: 'e4', source: 'email-2', target: 'exit-1' },
        ],
    },
};
const cartPersistenceTemplate = {
    id: 'cart-persistence',
    name: 'Cart Persistence',
    description: 'Help customers access their cart across devices.',
    category: 'engagement',
    triggerType: 'custom_event',
    triggerDescription: 'When cart is saved',
    estimatedDuration: '1 day',
    previewSteps: ['Cart saved trigger', 'Send cart access email'],
    definition: {
        startNodeId: 'trigger-1',
        nodes: [
            {
                id: 'trigger-1',
                type: 'trigger',
                position: { x: NODE_START_X, y: NODE_START_Y },
                data: {
                    label: 'Cart Saved',
                    config: { triggerType: 'custom_event', eventName: 'cart_saved' },
                },
            },
            {
                id: 'email-1',
                type: 'send_email',
                position: { x: NODE_START_X, y: NODE_START_Y + NODE_VERTICAL_SPACING },
                data: {
                    label: 'Cart Access',
                    config: {
                        subject: '🛒 {{name}}, your cart has been saved',
                        body: 'Hi {{name}},\n\nYour cart has been saved!\n\n📱 Access from any device\n⏰ Items reserved for 48 hours\n\n[View Your Cart]\n\nYour items:\n[Cart Items Preview]\n\nBest,\nThe Team',
                        preheader: 'Continue shopping anytime, anywhere',
                    },
                },
            },
            {
                id: 'exit-1',
                type: 'exit_flow',
                position: { x: NODE_START_X, y: NODE_START_Y + NODE_VERTICAL_SPACING * 2 },
                data: {
                    label: 'Exit Flow',
                    config: { reason: 'Cart persistence email sent' },
                },
            },
        ],
        edges: [
            { id: 'e0', source: 'trigger-1', target: 'email-1' },
            { id: 'e1', source: 'email-1', target: 'exit-1' },
        ],
    },
};
const smsReengagementTemplate = {
    id: 'sms-reengagement',
    name: 'SMS Re-engagement',
    description: 'Re-engage inactive customers via SMS with special offers.',
    category: 'reactivation',
    triggerType: 'custom_event',
    triggerDescription: 'When customer is inactive 30+ days',
    estimatedDuration: '5 days',
    previewSteps: [
        'Inactivity trigger',
        'Send re-engagement SMS',
        'Wait 3 days',
        'Send follow-up SMS',
    ],
    definition: {
        startNodeId: 'trigger-1',
        nodes: [
            {
                id: 'trigger-1',
                type: 'trigger',
                position: { x: NODE_START_X, y: NODE_START_Y },
                data: {
                    label: '30+ Days Inactive',
                    config: { triggerType: 'custom_event', eventName: 'customer_inactive_30d' },
                },
            },
            {
                id: 'sms-1',
                type: 'send_sms',
                position: { x: NODE_START_X, y: NODE_START_Y + NODE_VERTICAL_SPACING },
                data: {
                    label: 'Re-engagement SMS',
                    config: {
                        message: '{{name}}, we miss you! 🎁 Here is 20% off your next order: CODE20. Shop now: [Link]',
                    },
                },
            },
            {
                id: 'wait-1',
                type: 'wait',
                position: { x: NODE_START_X, y: NODE_START_Y + NODE_VERTICAL_SPACING * 2 },
                data: {
                    label: 'Wait 3 days',
                    config: { delay: 259200, unit: 'days' },
                },
            },
            {
                id: 'sms-2',
                type: 'send_sms',
                position: { x: NODE_START_X, y: NODE_START_Y + NODE_VERTICAL_SPACING * 3 },
                data: {
                    label: 'Follow-up SMS',
                    config: {
                        message: "⏰ {{name}}, your 20% off expires soon! Don't miss out: [Link]",
                    },
                },
            },
            {
                id: 'exit-1',
                type: 'exit_flow',
                position: { x: NODE_START_X, y: NODE_START_Y + NODE_VERTICAL_SPACING * 4 },
                data: {
                    label: 'Exit Flow',
                    config: { reason: 'SMS re-engagement completed' },
                },
            },
        ],
        edges: [
            { id: 'e0', source: 'trigger-1', target: 'sms-1' },
            { id: 'e1', source: 'sms-1', target: 'wait-1' },
            { id: 'e2', source: 'wait-1', target: 'sms-2' },
            { id: 'e3', source: 'sms-2', target: 'exit-1' },
        ],
    },
};
const emailReengagementTemplate = {
    id: 'email-reengagement',
    name: 'Email Re-engagement',
    description: "Re-engage customers who haven't opened emails recently.",
    category: 'reactivation',
    triggerType: 'custom_event',
    triggerDescription: 'When no email opens in 60 days',
    estimatedDuration: '14 days',
    previewSteps: [
        'Non-opener trigger',
        'Send re-engagement email',
        'Wait 7 days',
        'Send different subject line',
    ],
    definition: {
        startNodeId: 'trigger-1',
        nodes: [
            {
                id: 'trigger-1',
                type: 'trigger',
                position: { x: NODE_START_X, y: NODE_START_Y },
                data: {
                    label: 'No Opens 60 Days',
                    config: { triggerType: 'custom_event', eventName: 'email_non_opener_60d' },
                },
            },
            {
                id: 'email-1',
                type: 'send_email',
                position: { x: NODE_START_X, y: NODE_START_Y + NODE_VERTICAL_SPACING },
                data: {
                    label: 'Re-engagement Email',
                    config: {
                        subject: '{{name}}, are we still friends?',
                        body: "Hi {{name}},\n\nWe've noticed you haven't opened our emails lately.\n\nWe miss you! Here's what you've been missing:\n\n🆕 [Recent Update 1]\n🆕 [Recent Update 2]\n🎁 [Special Offer]\n\n[Come Back & Save 15%]\n\nStill not interested? [Update Preferences]\n\nBest,\nThe Team",
                        preheader: 'We miss you + a special offer inside',
                    },
                },
            },
            {
                id: 'wait-1',
                type: 'wait',
                position: { x: NODE_START_X, y: NODE_START_Y + NODE_VERTICAL_SPACING * 2 },
                data: {
                    label: 'Wait 7 days',
                    config: { delay: 604800, unit: 'days' },
                },
            },
            {
                id: 'email-2',
                type: 'send_email',
                position: { x: NODE_START_X, y: NODE_START_Y + NODE_VERTICAL_SPACING * 3 },
                data: {
                    label: 'Different Angle',
                    config: {
                        subject: '🎁 A gift for you, {{name}}',
                        body: 'Hi {{name}},\n\nWe have a gift waiting for you!\n\n🎁 [Special Offer Details]\n\n[Claim Your Gift]\n\nThis offer expires in 48 hours.\n\nBest,\nThe Team',
                        preheader: 'Your exclusive gift is waiting',
                    },
                },
            },
            {
                id: 'exit-1',
                type: 'exit_flow',
                position: { x: NODE_START_X, y: NODE_START_Y + NODE_VERTICAL_SPACING * 4 },
                data: {
                    label: 'Exit Flow',
                    config: { reason: 'Email re-engagement completed' },
                },
            },
        ],
        edges: [
            { id: 'e0', source: 'trigger-1', target: 'email-1' },
            { id: 'e1', source: 'email-1', target: 'wait-1' },
            { id: 'e2', source: 'wait-1', target: 'email-2' },
            { id: 'e3', source: 'email-2', target: 'exit-1' },
        ],
    },
};
const lastChanceTemplate = {
    id: 'last-chance',
    name: 'Last Chance',
    description: 'Final re-engagement attempt before list cleanup.',
    category: 'reactivation',
    triggerType: 'custom_event',
    triggerDescription: 'Before list removal',
    estimatedDuration: '7 days',
    previewSteps: ['Pre-removal trigger', 'Send last chance email', 'Wait 5 days', 'Final reminder'],
    definition: {
        startNodeId: 'trigger-1',
        nodes: [
            {
                id: 'trigger-1',
                type: 'trigger',
                position: { x: NODE_START_X, y: NODE_START_Y },
                data: {
                    label: 'Pre-Removal',
                    config: { triggerType: 'custom_event', eventName: 'pre_list_removal' },
                },
            },
            {
                id: 'email-1',
                type: 'send_email',
                position: { x: NODE_START_X, y: NODE_START_Y + NODE_VERTICAL_SPACING },
                data: {
                    label: 'Last Chance Email',
                    config: {
                        subject: '⚠️ {{name}}, is this goodbye?',
                        body: "Hi {{name}},\n\nWe're about to remove you from our list.\n\nIf you still want to hear from us, click below to stay subscribed:\n\n[Keep Me Subscribed]\n\nNo action? We'll remove you in 7 days.\n\nWe understand if you're not interested anymore. No hard feelings!\n\nBest,\nThe Team",
                        preheader: 'Action required to stay subscribed',
                    },
                },
            },
            {
                id: 'wait-1',
                type: 'wait',
                position: { x: NODE_START_X, y: NODE_START_Y + NODE_VERTICAL_SPACING * 2 },
                data: {
                    label: 'Wait 5 days',
                    config: { delay: 432000, unit: 'days' },
                },
            },
            {
                id: 'email-2',
                type: 'send_email',
                position: { x: NODE_START_X, y: NODE_START_Y + NODE_VERTICAL_SPACING * 3 },
                data: {
                    label: 'Final Reminder',
                    config: {
                        subject: '🚨 Final notice: {{name}}, 48 hours left',
                        body: "Hi {{name}},\n\nThis is your final reminder.\n\nIn 48 hours, we'll remove you from our list.\n\n[I Want to Stay!]\n\nIf you change your mind later, you can always re-subscribe.\n\nBest,\nThe Team",
                        preheader: 'Last chance to stay subscribed',
                    },
                },
            },
            {
                id: 'exit-1',
                type: 'exit_flow',
                position: { x: NODE_START_X, y: NODE_START_Y + NODE_VERTICAL_SPACING * 4 },
                data: {
                    label: 'Exit Flow',
                    config: { reason: 'Last chance flow completed' },
                },
            },
        ],
        edges: [
            { id: 'e0', source: 'trigger-1', target: 'email-1' },
            { id: 'e1', source: 'email-1', target: 'wait-1' },
            { id: 'e2', source: 'wait-1', target: 'email-2' },
            { id: 'e3', source: 'email-2', target: 'exit-1' },
        ],
    },
};
const inactiveCustomerTemplate = {
    id: 'inactive-customer',
    name: 'Inactive Customer',
    description: "Re-engage customers who haven't purchased in 90+ days.",
    category: 'reactivation',
    triggerType: 'custom_event',
    triggerDescription: 'When no purchase in 90 days',
    estimatedDuration: '14 days',
    previewSteps: [
        'Inactivity trigger',
        'Send "We miss you" email',
        'Wait 5 days',
        'Send incentive offer',
        'Wait 7 days',
        'Send final offer',
    ],
    definition: {
        startNodeId: 'trigger-1',
        nodes: [
            {
                id: 'trigger-1',
                type: 'trigger',
                position: { x: NODE_START_X, y: NODE_START_Y },
                data: {
                    label: '90+ Days No Purchase',
                    config: { triggerType: 'custom_event', eventName: 'no_purchase_90d' },
                },
            },
            {
                id: 'email-1',
                type: 'send_email',
                position: { x: NODE_START_X, y: NODE_START_Y + NODE_VERTICAL_SPACING },
                data: {
                    label: 'We Miss You',
                    config: {
                        subject: '💔 {{name}}, we miss you!',
                        body: "Hi {{name}},\n\nIt's been a while since your last visit!\n\nHere's what's new:\n🆕 [New Product/Feature 1]\n🆕 [New Product/Feature 2]\n🆕 [New Product/Feature 3]\n\n[See What's New]\n\nWe'd love to see you again!\n\nBest,\nThe Team",
                        preheader: 'See what you have been missing',
                    },
                },
            },
            {
                id: 'wait-1',
                type: 'wait',
                position: { x: NODE_START_X, y: NODE_START_Y + NODE_VERTICAL_SPACING * 2 },
                data: {
                    label: 'Wait 5 days',
                    config: { delay: 432000, unit: 'days' },
                },
            },
            {
                id: 'email-2',
                type: 'send_email',
                position: { x: NODE_START_X, y: NODE_START_Y + NODE_VERTICAL_SPACING * 3 },
                data: {
                    label: 'Incentive Offer',
                    config: {
                        subject: '🎁 {{name}}, a special gift just for you',
                        body: "Hi {{name}},\n\nWe want you back! Here's a special offer:\n\n🎁 25% off your next order\n📦 Free shipping\n⏰ Valid for 7 days\n\nUse code: COMEBACK25\n\n[Shop Now]\n\nBest,\nThe Team",
                        preheader: '25% off + free shipping',
                    },
                },
            },
            {
                id: 'wait-2',
                type: 'wait',
                position: { x: NODE_START_X, y: NODE_START_Y + NODE_VERTICAL_SPACING * 4 },
                data: {
                    label: 'Wait 7 days',
                    config: { delay: 604800, unit: 'days' },
                },
            },
            {
                id: 'email-3',
                type: 'send_email',
                position: { x: NODE_START_X, y: NODE_START_Y + NODE_VERTICAL_SPACING * 5 },
                data: {
                    label: 'Final Offer',
                    config: {
                        subject: '⏰ {{name}}, your offer expires tomorrow!',
                        body: 'Hi {{name}},\n\nLast chance!\n\nYour 25% off expires tomorrow.\n\n[Use My Discount]\n\nCode: COMEBACK25\n\nBest,\nThe Team',
                        preheader: 'Final reminder - offer expires tomorrow',
                    },
                },
            },
            {
                id: 'exit-1',
                type: 'exit_flow',
                position: { x: NODE_START_X, y: NODE_START_Y + NODE_VERTICAL_SPACING * 6 },
                data: {
                    label: 'Exit Flow',
                    config: { reason: 'Inactive customer flow completed' },
                },
            },
        ],
        edges: [
            { id: 'e0', source: 'trigger-1', target: 'email-1' },
            { id: 'e1', source: 'email-1', target: 'wait-1' },
            { id: 'e2', source: 'wait-1', target: 'email-2' },
            { id: 'e3', source: 'email-2', target: 'wait-2' },
            { id: 'e4', source: 'wait-2', target: 'email-3' },
            { id: 'e5', source: 'email-3', target: 'exit-1' },
        ],
    },
};
const lapsedVIPTemplate = {
    id: 'lapsed-vip',
    name: 'Lapsed VIP',
    description: 'Win back valuable VIP customers who have gone quiet.',
    category: 'reactivation',
    triggerType: 'custom_event',
    triggerDescription: 'When VIP is inactive 60+ days',
    estimatedDuration: '10 days',
    previewSteps: [
        'VIP inactivity trigger',
        'Send personalized outreach',
        'Wait 5 days',
        'Send exclusive VIP offer',
    ],
    definition: {
        startNodeId: 'trigger-1',
        nodes: [
            {
                id: 'trigger-1',
                type: 'trigger',
                position: { x: NODE_START_X, y: NODE_START_Y },
                data: {
                    label: 'VIP Inactive 60 Days',
                    config: { triggerType: 'custom_event', eventName: 'vip_inactive_60d' },
                },
            },
            {
                id: 'email-1',
                type: 'send_email',
                position: { x: NODE_START_X, y: NODE_START_Y + NODE_VERTICAL_SPACING },
                data: {
                    label: 'Personal Outreach',
                    config: {
                        subject: '{{name}}, a personal note from our founder',
                        body: "Hi {{name}},\n\nI noticed you haven't visited us in a while, and I wanted to reach out personally.\n\nAs one of our VIP members, you're incredibly important to us. Is there anything we could be doing better?\n\nI'd love to hear your feedback - just reply to this email.\n\nAs a token of appreciation, here's an exclusive offer just for you:\n\n🌟 [VIP-Only Offer]\n\n[Claim VIP Offer]\n\nBest,\n[Founder Name]\nFounder",
                        preheader: 'A personal note + exclusive VIP offer',
                    },
                },
            },
            {
                id: 'wait-1',
                type: 'wait',
                position: { x: NODE_START_X, y: NODE_START_Y + NODE_VERTICAL_SPACING * 2 },
                data: {
                    label: 'Wait 5 days',
                    config: { delay: 432000, unit: 'days' },
                },
            },
            {
                id: 'email-2',
                type: 'send_email',
                position: { x: NODE_START_X, y: NODE_START_Y + NODE_VERTICAL_SPACING * 3 },
                data: {
                    label: 'Exclusive VIP Offer',
                    config: {
                        subject: '👑 {{name}}, VIP-only: 30% off everything',
                        body: 'Hi {{name}},\n\nThis offer is exclusively for our VIP members like you:\n\n👑 30% off your entire order\n🚚 Free express shipping\n🎁 Free gift with purchase\n⏰ VIP early access to new arrivals\n\nUse code: VIP30\n\n[Shop VIP Sale]\n\nValid for 5 days only.\n\nBest,\nThe Team',
                        preheader: 'VIP exclusive: 30% off + free gift',
                    },
                },
            },
            {
                id: 'exit-1',
                type: 'exit_flow',
                position: { x: NODE_START_X, y: NODE_START_Y + NODE_VERTICAL_SPACING * 4 },
                data: {
                    label: 'Exit Flow',
                    config: { reason: 'Lapsed VIP flow completed' },
                },
            },
        ],
        edges: [
            { id: 'e0', source: 'trigger-1', target: 'email-1' },
            { id: 'e1', source: 'email-1', target: 'wait-1' },
            { id: 'e2', source: 'wait-1', target: 'email-2' },
            { id: 'e3', source: 'email-2', target: 'exit-1' },
        ],
    },
};
export const FLOW_TEMPLATES = [
    abandonedCartTemplate,
    browseAbandonmentTemplate,
    welcomeSeriesTemplate,
    postPurchaseTemplate,
    winBackTemplate,
    orderFulfillmentTemplate,
    doubleOptInTemplate,
    subscriptionStartedTemplate,
    leadMagnetTemplate,
    referralProgramTemplate,
    trialStartedTemplate,
    waitlistTemplate,
    earlyAccessTemplate,
    newsletterWelcomeTemplate,
    giftCardPurchaseTemplate,
    birthdayCampaignTemplate,
    reorderReminderTemplate,
    vipRecognitionTemplate,
    loyaltyMilestoneTemplate,
    crossSellTemplate,
    upsellTemplate,
    subscriptionRenewalTemplate,
    productUsageTipsTemplate,
    customerSuccessCheckInTemplate,
    upgradeSequenceTemplate,
    profileCompletionTemplate,
    anniversaryTemplate,
    quantityBreakTemplate,
    reviewRequestTemplate,
    paymentFailedTemplate,
    flashSaleTemplate,
    newProductLaunchTemplate,
    feedbackRequestTemplate,
    educationalDripTemplate,
    accountSecurityTemplate,
    eventReminderTemplate,
    webinarFollowupTemplate,
    surveyInvitationTemplate,
    shippingConfirmationTemplate,
    featureAnnouncementTemplate,
    communityEngagementTemplate,
    ugcRequestTemplate,
    contestEntryTemplate,
    deliveryConfirmationTemplate,
    refundProcessedTemplate,
    subscriptionPauseTemplate,
    returnInitiatedTemplate,
    wishlistReminderTemplate,
    cartPersistenceTemplate,
    backInStockTemplate,
    priceDropTemplate,
    subscriptionCancelledTemplate,
    seasonalReengagementTemplate,
    lowStockAlertTemplate,
    sunsetFlowTemplate,
    smsReengagementTemplate,
    emailReengagementTemplate,
    lastChanceTemplate,
    inactiveCustomerTemplate,
    lapsedVIPTemplate,
];
export function getFlowTemplates() {
    return FLOW_TEMPLATES;
}
export function getFlowTemplateById(templateId) {
    return FLOW_TEMPLATES.find((t) => t.id === templateId) || null;
}
export function getFlowTemplatesByCategory(category) {
    return FLOW_TEMPLATES.filter((t) => t.category === category);
}
export function getFlowTemplatesByTrigger(triggerType) {
    return FLOW_TEMPLATES.filter((t) => t.triggerType === triggerType);
}
