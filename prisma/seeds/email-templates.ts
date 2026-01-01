import { PrismaClient, EmailTemplateCategory } from '@prisma/client';

interface EmailTemplateSeed {
  name: string;
  description: string;
  category: EmailTemplateCategory;
  tags: string[];
  subject: string;
  preheader?: string;
  body: string;
  isDefault: boolean;
}

export const emailTemplateSeedData: EmailTemplateSeed[] = [
  // ===== TRANSACTIONAL =====
  {
    name: 'Order Confirmation',
    description: 'Sent immediately after a purchase is completed',
    category: 'transactional',
    tags: ['order', 'confirmation', 'purchase'],
    subject: 'Order Confirmed - #{{orderId}}',
    preheader: 'Thank you for your purchase!',
    body: `Hi {{firstName}},

Thank you for your order! We're excited to confirm that we've received your order #{{orderId}}.

Order Summary:
{{orderItems}}

Total: {{orderTotal}}

We'll send you another email when your order ships.

Thanks for shopping with us!`,
    isDefault: true,
  },
  {
    name: 'Shipping Confirmation',
    description: 'Sent when order is shipped',
    category: 'transactional',
    tags: ['shipping', 'tracking', 'order'],
    subject: 'Your Order Has Shipped! - #{{orderId}}',
    preheader: 'Track your package',
    body: `Hi {{firstName}},

Great news! Your order #{{orderId}} is on its way!

Tracking Number: {{trackingNumber}}
Carrier: {{carrier}}
Estimated Delivery: {{estimatedDelivery}}

Track your package: {{trackingUrl}}

Thanks for your patience!`,
    isDefault: true,
  },
  {
    name: 'Delivery Confirmation',
    description: 'Sent when order is delivered',
    category: 'transactional',
    tags: ['delivery', 'order', 'completed'],
    subject: 'Your Order Has Been Delivered!',
    preheader: 'Your package has arrived',
    body: `Hi {{firstName}},

Your order #{{orderId}} has been delivered!

We hope you love your purchase. If you have any questions or concerns, please don't hesitate to reach out.

Leave a review: {{reviewUrl}}

Thank you for shopping with us!`,
    isDefault: false,
  },
  {
    name: 'Order Refund',
    description: 'Sent when a refund is processed',
    category: 'transactional',
    tags: ['refund', 'order', 'money'],
    subject: 'Your Refund Has Been Processed',
    preheader: 'Refund confirmation for order #{{orderId}}',
    body: `Hi {{firstName}},

We've processed your refund for order #{{orderId}}.

Refund Amount: {{refundAmount}}
Original Payment Method: {{paymentMethod}}

Please allow 5-10 business days for the refund to appear in your account.

If you have any questions, please contact us.`,
    isDefault: false,
  },
  {
    name: 'Password Reset',
    description: 'Sent when user requests password reset',
    category: 'transactional',
    tags: ['password', 'security', 'account'],
    subject: 'Reset Your Password',
    preheader: 'Password reset request',
    body: `Hi {{firstName}},

We received a request to reset your password. Click the link below to create a new password:

{{resetLink}}

This link will expire in 24 hours.

If you didn't request this, please ignore this email or contact support if you have concerns.`,
    isDefault: true,
  },
  {
    name: 'Account Verification',
    description: 'Sent to verify email address',
    category: 'transactional',
    tags: ['verification', 'account', 'email'],
    subject: 'Verify Your Email Address',
    preheader: 'One more step to complete your registration',
    body: `Hi {{firstName}},

Welcome! Please verify your email address to complete your account setup:

{{verificationLink}}

This link will expire in 48 hours.

If you didn't create an account, please ignore this email.`,
    isDefault: true,
  },
  {
    name: 'Invoice',
    description: 'Invoice for completed purchase',
    category: 'transactional',
    tags: ['invoice', 'billing', 'payment'],
    subject: 'Invoice #{{invoiceNumber}} - {{companyName}}',
    preheader: 'Your invoice is ready',
    body: `Hi {{firstName}},

Please find your invoice attached.

Invoice #: {{invoiceNumber}}
Date: {{invoiceDate}}
Amount: {{invoiceAmount}}
Due Date: {{dueDate}}

View Invoice: {{invoiceUrl}}

Thank you for your business!`,
    isDefault: false,
  },
  {
    name: 'Subscription Confirmation',
    description: 'Sent when subscription starts',
    category: 'transactional',
    tags: ['subscription', 'billing', 'recurring'],
    subject: 'Subscription Confirmed - {{planName}}',
    preheader: 'Welcome to {{planName}}',
    body: `Hi {{firstName}},

Welcome to {{planName}}!

Your subscription details:
Plan: {{planName}}
Price: {{planPrice}}/{{billingCycle}}
Next Billing Date: {{nextBillingDate}}

Manage your subscription: {{accountUrl}}

Thank you for subscribing!`,
    isDefault: false,
  },

  // ===== PROMOTIONAL =====
  {
    name: 'Flash Sale Announcement',
    description: 'Announce limited-time sales',
    category: 'promotional',
    tags: ['sale', 'discount', 'limited-time'],
    subject: 'FLASH SALE: {{discount}}% Off Everything!',
    preheader: 'Limited time only - ends {{endDate}}',
    body: `Hi {{firstName}},

Our biggest sale of the season is HERE!

Get {{discount}}% off EVERYTHING for the next {{hours}} hours only!

Use code: {{code}}

Shop now: {{shopUrl}}

Hurry - this sale ends {{endDate}}!`,
    isDefault: true,
  },
  {
    name: 'New Product Launch',
    description: 'Announce new product arrivals',
    category: 'promotional',
    tags: ['new', 'product', 'launch'],
    subject: 'Just Dropped: {{productName}}',
    preheader: 'Be the first to shop our newest arrival',
    body: `Hi {{firstName}},

Introducing {{productName}} - our latest and greatest!

{{productDescription}}

Price: {{price}}

Shop Now: {{productUrl}}

Don't miss out - these tend to sell fast!`,
    isDefault: true,
  },
  {
    name: 'Seasonal Sale',
    description: 'Seasonal promotional campaigns',
    category: 'promotional',
    tags: ['seasonal', 'sale', 'holiday'],
    subject: '{{season}} Sale: Up to {{discount}}% Off',
    preheader: 'Shop our biggest {{season}} deals',
    body: `Hi {{firstName}},

Our {{season}} Sale is in full swing!

Save up to {{discount}}% on select items.

Top picks for you:
{{recommendedProducts}}

Shop the sale: {{saleUrl}}

Sale ends {{endDate}}!`,
    isDefault: false,
  },
  {
    name: 'VIP Exclusive Offer',
    description: 'Special offers for VIP customers',
    category: 'promotional',
    tags: ['vip', 'exclusive', 'loyalty'],
    subject: 'VIP Exclusive: {{discount}}% Off Just for You',
    preheader: 'A special thank you for being a valued customer',
    body: `Hi {{firstName}},

As one of our most valued customers, we're giving you exclusive early access to our sale!

Your VIP code: {{code}}
Discount: {{discount}}% off your entire order

This exclusive offer expires {{expiryDate}}.

Shop your VIP sale: {{shopUrl}}`,
    isDefault: false,
  },
  {
    name: 'Free Shipping Promotion',
    description: 'Free shipping offer',
    category: 'promotional',
    tags: ['free-shipping', 'promotion'],
    subject: 'FREE Shipping - This Weekend Only!',
    preheader: 'No minimum purchase required',
    body: `Hi {{firstName}},

This weekend only: FREE shipping on all orders!

No minimum purchase required.
No code needed - automatically applied at checkout.

Shop now: {{shopUrl}}

Offer valid through {{endDate}}.`,
    isDefault: false,
  },
  {
    name: 'Buy One Get One',
    description: 'BOGO promotional offer',
    category: 'promotional',
    tags: ['bogo', 'promotion', 'deal'],
    subject: 'Buy One, Get One {{discount}}% Off!',
    preheader: 'Stock up and save',
    body: `Hi {{firstName}},

Buy one, get one {{discount}}% off!

Mix and match across {{category}}.

Use code: {{code}}

Shop now: {{shopUrl}}

Offer ends {{endDate}}.`,
    isDefault: false,
  },
  {
    name: 'Clearance Sale',
    description: 'Clearance and final sale items',
    category: 'promotional',
    tags: ['clearance', 'final-sale', 'discount'],
    subject: 'Final Clearance: Up to {{discount}}% Off',
    preheader: 'Last chance to save big',
    body: `Hi {{firstName}},

Our final clearance sale is here!

Save up to {{discount}}% on select items. Once they're gone, they're gone!

Shop clearance: {{clearanceUrl}}

All sales final.`,
    isDefault: false,
  },
  {
    name: 'Loyalty Points Reminder',
    description: 'Remind customers about unused points',
    category: 'promotional',
    tags: ['loyalty', 'points', 'rewards'],
    subject: 'You Have {{points}} Points to Spend!',
    preheader: 'Your rewards are waiting',
    body: `Hi {{firstName}},

Did you know you have {{points}} loyalty points waiting?

That's worth {{pointsValue}} towards your next purchase!

Redeem your points: {{shopUrl}}

Points expire {{expiryDate}}.`,
    isDefault: false,
  },

  // ===== LIFECYCLE =====
  {
    name: 'Welcome Email',
    description: 'First email to new subscribers',
    category: 'lifecycle',
    tags: ['welcome', 'onboarding', 'new-subscriber'],
    subject: 'Welcome to {{companyName}}!',
    preheader: 'Thanks for joining us',
    body: `Hi {{firstName}},

Welcome to {{companyName}}! We're thrilled to have you.

Here's what you can expect:
- Exclusive deals and early access to sales
- New product announcements
- Helpful tips and content

As a thank you for subscribing, here's {{discount}}% off your first order:
Code: {{code}}

Start shopping: {{shopUrl}}`,
    isDefault: true,
  },
  {
    name: 'Welcome Series - Day 3',
    description: 'Second email in welcome series',
    category: 'lifecycle',
    tags: ['welcome', 'series', 'onboarding'],
    subject: 'Discover Our Best Sellers',
    preheader: 'See what everyone is loving',
    body: `Hi {{firstName}},

Now that you've had a chance to look around, here are our customer favorites:

{{bestSellers}}

Still have your welcome discount? Use code {{code}} for {{discount}}% off!

Shop best sellers: {{shopUrl}}`,
    isDefault: false,
  },
  {
    name: 'Welcome Series - Day 7',
    description: 'Third email in welcome series',
    category: 'lifecycle',
    tags: ['welcome', 'series', 'onboarding'],
    subject: 'Last Chance: {{discount}}% Off Expires Soon',
    preheader: 'Your welcome discount is about to expire',
    body: `Hi {{firstName}},

Your {{discount}}% welcome discount expires in 24 hours!

Don't miss out on this exclusive offer.

Use code: {{code}}

Shop now: {{shopUrl}}`,
    isDefault: false,
  },
  {
    name: 'First Purchase Thank You',
    description: 'Thank customer after first purchase',
    category: 'lifecycle',
    tags: ['first-purchase', 'thank-you', 'loyalty'],
    subject: 'Thank You for Your First Order!',
    preheader: 'You made our day',
    body: `Hi {{firstName}},

Thank you for your first order with us!

We're so grateful you chose {{companyName}}. As a token of our appreciation, here's {{discount}}% off your next order:

Code: {{code}}

We can't wait to see you again!`,
    isDefault: true,
  },
  {
    name: 'Post-Purchase Follow Up',
    description: 'Check in after purchase delivery',
    category: 'lifecycle',
    tags: ['post-purchase', 'feedback', 'review'],
    subject: 'How Are You Enjoying Your Purchase?',
    preheader: 'We\'d love to hear from you',
    body: `Hi {{firstName}},

It's been a week since your order arrived. We hope you're loving it!

We'd really appreciate if you could take a moment to leave a review:
{{reviewUrl}}

Have questions or concerns? We're here to help!`,
    isDefault: true,
  },
  {
    name: 'Birthday Email',
    description: 'Birthday wishes with special offer',
    category: 'lifecycle',
    tags: ['birthday', 'celebration', 'personal'],
    subject: 'Happy Birthday, {{firstName}}! 🎂',
    preheader: 'A special gift just for you',
    body: `Happy Birthday, {{firstName}}!

To celebrate your special day, we're giving you {{discount}}% off your next purchase!

Use code: {{code}}

This birthday treat expires {{expiryDate}}.

Have a wonderful birthday!`,
    isDefault: true,
  },
  {
    name: 'Anniversary Email',
    description: 'Customer anniversary celebration',
    category: 'lifecycle',
    tags: ['anniversary', 'loyalty', 'celebration'],
    subject: 'Happy Anniversary! {{years}} Year(s) Together',
    preheader: 'Thank you for being with us',
    body: `Hi {{firstName}},

Can you believe it's been {{years}} year(s) since you joined us?

Thank you for being part of our community!

To celebrate, here's {{discount}}% off your next order:
Code: {{code}}

Here's to many more years together!`,
    isDefault: false,
  },
  {
    name: 'Win-Back Email',
    description: 'Re-engage inactive customers',
    category: 'lifecycle',
    tags: ['win-back', 'reactivation', 'inactive'],
    subject: 'We Miss You, {{firstName}}!',
    preheader: 'It\'s been a while - here\'s a special offer',
    body: `Hi {{firstName}},

We've noticed it's been a while since your last visit. We miss you!

A lot has changed since you were last here:
{{newProducts}}

Here's {{discount}}% off to welcome you back:
Code: {{code}}

We hope to see you soon!`,
    isDefault: true,
  },
  {
    name: 'VIP Status Achieved',
    description: 'Congratulate customer on VIP status',
    category: 'lifecycle',
    tags: ['vip', 'loyalty', 'milestone'],
    subject: 'Congratulations! You\'ve Reached VIP Status',
    preheader: 'Welcome to the VIP club',
    body: `Hi {{firstName}},

Congratulations! You've officially reached VIP status!

Your VIP benefits include:
- {{benefit1}}
- {{benefit2}}
- {{benefit3}}

Thank you for being such a valued customer!

Shop your VIP perks: {{shopUrl}}`,
    isDefault: false,
  },
  {
    name: 'Subscription Renewal Reminder',
    description: 'Remind about upcoming subscription renewal',
    category: 'lifecycle',
    tags: ['subscription', 'renewal', 'reminder'],
    subject: 'Your Subscription Renews Soon',
    preheader: 'Your {{planName}} subscription renews on {{renewalDate}}',
    body: `Hi {{firstName}},

Your {{planName}} subscription will automatically renew on {{renewalDate}}.

Renewal Amount: {{amount}}
Payment Method: {{paymentMethod}}

No action needed - we'll take care of everything.

Want to make changes? Manage your subscription: {{accountUrl}}`,
    isDefault: false,
  },

  // ===== ENGAGEMENT =====
  {
    name: 'Product Recommendation',
    description: 'Personalized product suggestions',
    category: 'engagement',
    tags: ['recommendations', 'personalized', 'products'],
    subject: 'Picked Just for You, {{firstName}}',
    preheader: 'Products we think you\'ll love',
    body: `Hi {{firstName}},

Based on your recent activity, we think you'll love these:

{{recommendedProducts}}

Shop your picks: {{shopUrl}}`,
    isDefault: true,
  },
  {
    name: 'Back in Stock',
    description: 'Notify when wished item returns',
    category: 'engagement',
    tags: ['back-in-stock', 'inventory', 'wishlist'],
    subject: '{{productName}} is Back in Stock!',
    preheader: 'The item you wanted is available again',
    body: `Hi {{firstName}},

Great news! {{productName}} is back in stock!

Don't wait - this item tends to sell out quickly.

Get it now: {{productUrl}}`,
    isDefault: true,
  },
  {
    name: 'Price Drop Alert',
    description: 'Notify about price reduction on watched items',
    category: 'engagement',
    tags: ['price-drop', 'wishlist', 'deal'],
    subject: 'Price Drop Alert: {{productName}}',
    preheader: 'An item on your wishlist is now on sale',
    body: `Hi {{firstName}},

{{productName}} is now {{discount}}% off!

Was: {{originalPrice}}
Now: {{salePrice}}

Buy now before the price goes back up: {{productUrl}}`,
    isDefault: true,
  },
  {
    name: 'Low Stock Alert',
    description: 'Create urgency for low stock items',
    category: 'engagement',
    tags: ['low-stock', 'urgency', 'wishlist'],
    subject: 'Only {{quantity}} Left: {{productName}}',
    preheader: 'Don\'t miss out on this item',
    body: `Hi {{firstName}},

{{productName}} is almost gone! Only {{quantity}} left in stock.

Get it before it sells out: {{productUrl}}`,
    isDefault: false,
  },
  {
    name: 'New Blog Post',
    description: 'Share new content with subscribers',
    category: 'engagement',
    tags: ['blog', 'content', 'education'],
    subject: 'New Post: {{postTitle}}',
    preheader: 'Fresh content just for you',
    body: `Hi {{firstName}},

We just published a new post we think you'll enjoy:

{{postTitle}}

{{postExcerpt}}

Read more: {{postUrl}}`,
    isDefault: false,
  },
  {
    name: 'Survey Request',
    description: 'Request customer feedback',
    category: 'engagement',
    tags: ['survey', 'feedback', 'nps'],
    subject: 'Quick Question, {{firstName}}?',
    preheader: 'We value your opinion',
    body: `Hi {{firstName}},

We'd love to hear from you! Your feedback helps us improve.

Take our quick 2-minute survey: {{surveyUrl}}

As a thank you, you'll be entered to win {{prize}}!

Thank you for your time.`,
    isDefault: false,
  },
  {
    name: 'Refer a Friend',
    description: 'Encourage referrals',
    category: 'engagement',
    tags: ['referral', 'share', 'rewards'],
    subject: 'Give {{discount}}%, Get {{discount}}%',
    preheader: 'Share the love with friends',
    body: `Hi {{firstName}},

Love {{companyName}}? Share it with friends!

Give them {{discount}}% off their first order, and you'll get {{discount}}% off your next purchase.

Your unique referral link: {{referralUrl}}

Start sharing!`,
    isDefault: true,
  },
  {
    name: 'Social Media Follow',
    description: 'Encourage social media engagement',
    category: 'engagement',
    tags: ['social', 'community', 'follow'],
    subject: 'Join Our Community!',
    preheader: 'Follow us for exclusive content',
    body: `Hi {{firstName}},

Want to stay connected? Follow us on social media!

We share:
- Behind-the-scenes content
- Exclusive giveaways
- Early access to sales
- Community spotlights

Follow us:
{{socialLinks}}`,
    isDefault: false,
  },

  // ===== NOTIFICATION =====
  {
    name: 'Account Security Alert',
    description: 'Security notification for account changes',
    category: 'notification',
    tags: ['security', 'account', 'alert'],
    subject: 'Security Alert: Account Activity Detected',
    preheader: 'Important security notification',
    body: `Hi {{firstName}},

We detected the following activity on your account:

Activity: {{activityType}}
Date: {{activityDate}}
Location: {{location}}

If this was you, no action is needed.

If you don't recognize this activity, please secure your account immediately: {{securityUrl}}`,
    isDefault: true,
  },
  {
    name: 'Order Status Update',
    description: 'General order status notification',
    category: 'notification',
    tags: ['order', 'status', 'update'],
    subject: 'Order Update: {{status}}',
    preheader: 'Your order #{{orderId}} has been updated',
    body: `Hi {{firstName}},

Your order #{{orderId}} status has been updated:

New Status: {{status}}

{{statusMessage}}

Track your order: {{trackingUrl}}`,
    isDefault: false,
  },
  {
    name: 'Payment Failed',
    description: 'Notify about failed payment',
    category: 'notification',
    tags: ['payment', 'failed', 'billing'],
    subject: 'Action Required: Payment Failed',
    preheader: 'Please update your payment information',
    body: `Hi {{firstName}},

We were unable to process your payment of {{amount}} for {{description}}.

Please update your payment method to avoid service interruption: {{paymentUrl}}

If you have questions, please contact us.`,
    isDefault: true,
  },
  {
    name: 'Points Expiring',
    description: 'Alert about expiring loyalty points',
    category: 'notification',
    tags: ['points', 'expiry', 'loyalty'],
    subject: 'Your {{points}} Points Expire {{expiryDate}}',
    preheader: 'Use them before they\'re gone',
    body: `Hi {{firstName}},

Heads up! You have {{points}} loyalty points (worth {{pointsValue}}) that will expire on {{expiryDate}}.

Don't let them go to waste!

Redeem now: {{shopUrl}}`,
    isDefault: false,
  },
  {
    name: 'Subscription Cancellation',
    description: 'Confirm subscription cancellation',
    category: 'notification',
    tags: ['subscription', 'cancellation', 'account'],
    subject: 'Your Subscription Has Been Cancelled',
    preheader: 'We\'re sorry to see you go',
    body: `Hi {{firstName}},

Your {{planName}} subscription has been cancelled as requested.

Your access continues until {{endDate}}.

Changed your mind? Resubscribe anytime: {{resubscribeUrl}}

We hope to see you again!`,
    isDefault: false,
  },
  {
    name: 'Waitlist Notification',
    description: 'Notify customer about waitlist availability',
    category: 'notification',
    tags: ['waitlist', 'availability', 'product'],
    subject: 'You\'re Off the Waitlist!',
    preheader: '{{productName}} is ready for you',
    body: `Hi {{firstName}},

Great news! You've been selected from the waitlist for {{productName}}!

You have 24 hours to complete your purchase before we offer it to the next person.

Get it now: {{productUrl}}`,
    isDefault: false,
  },

  // ===== NEWSLETTER =====
  {
    name: 'Weekly Newsletter',
    description: 'Weekly content digest',
    category: 'newsletter',
    tags: ['newsletter', 'weekly', 'digest'],
    subject: 'This Week at {{companyName}}',
    preheader: 'Your weekly roundup',
    body: `Hi {{firstName}},

Here's what's new this week:

NEW ARRIVALS
{{newArrivals}}

TOP STORIES
{{topStories}}

UPCOMING EVENTS
{{upcomingEvents}}

See you next week!`,
    isDefault: true,
  },
  {
    name: 'Monthly Newsletter',
    description: 'Monthly content digest',
    category: 'newsletter',
    tags: ['newsletter', 'monthly', 'digest'],
    subject: '{{month}} at {{companyName}}',
    preheader: 'Your monthly roundup',
    body: `Hi {{firstName}},

Here's your monthly recap:

HIGHLIGHTS
{{highlights}}

BEST SELLERS
{{bestSellers}}

COMING SOON
{{comingSoon}}

Thank you for being part of our community!`,
    isDefault: false,
  },
  {
    name: 'Product Spotlight',
    description: 'Featured product deep dive',
    category: 'newsletter',
    tags: ['newsletter', 'product', 'spotlight'],
    subject: 'Spotlight: {{productName}}',
    preheader: 'Everything you need to know',
    body: `Hi {{firstName}},

This week's spotlight: {{productName}}

{{productStory}}

Why customers love it:
{{customerReviews}}

Learn more: {{productUrl}}`,
    isDefault: false,
  },
  {
    name: 'Industry News',
    description: 'Share relevant industry updates',
    category: 'newsletter',
    tags: ['newsletter', 'industry', 'news'],
    subject: '{{industry}} News You Need to Know',
    preheader: 'Stay informed with the latest updates',
    body: `Hi {{firstName}},

Here's what's happening in {{industry}}:

{{newsItems}}

What this means for you:
{{analysis}}

Read more: {{articleUrl}}`,
    isDefault: false,
  },

  // ===== CUSTOM =====
  {
    name: 'Event Invitation',
    description: 'Invite to special event',
    category: 'custom',
    tags: ['event', 'invitation', 'rsvp'],
    subject: 'You\'re Invited: {{eventName}}',
    preheader: 'Join us for {{eventName}}',
    body: `Hi {{firstName}},

You're invited to {{eventName}}!

When: {{eventDate}}
Where: {{eventLocation}}
{{eventDescription}}

RSVP: {{rsvpUrl}}

We hope to see you there!`,
    isDefault: false,
  },
  {
    name: 'Thank You Note',
    description: 'General thank you message',
    category: 'custom',
    tags: ['thank-you', 'appreciation', 'gratitude'],
    subject: 'Thank You, {{firstName}}!',
    preheader: 'A note of appreciation',
    body: `Hi {{firstName}},

We just wanted to take a moment to say thank you.

{{thankYouMessage}}

Your support means the world to us.

With gratitude,
The {{companyName}} Team`,
    isDefault: false,
  },
  {
    name: 'Apology Email',
    description: 'Apologize for issues or mistakes',
    category: 'custom',
    tags: ['apology', 'service', 'issue'],
    subject: 'We\'re Sorry, {{firstName}}',
    preheader: 'An apology from {{companyName}}',
    body: `Hi {{firstName}},

We owe you an apology.

{{apologyMessage}}

To make it right, we're offering you {{compensation}}.

We value your trust and are committed to doing better.

Sincerely,
The {{companyName}} Team`,
    isDefault: false,
  },
  {
    name: 'Contest Announcement',
    description: 'Announce contest or giveaway',
    category: 'custom',
    tags: ['contest', 'giveaway', 'prize'],
    subject: 'Enter to Win: {{prize}}!',
    preheader: 'Don\'t miss your chance',
    body: `Hi {{firstName}},

We're giving away {{prize}}!

How to enter:
{{entryInstructions}}

Contest ends {{endDate}}.

Enter now: {{contestUrl}}

Good luck!`,
    isDefault: false,
  },
  {
    name: 'Company Announcement',
    description: 'Important company updates',
    category: 'custom',
    tags: ['announcement', 'company', 'news'],
    subject: 'Important Update from {{companyName}}',
    preheader: 'News you should know',
    body: `Hi {{firstName}},

We have some important news to share:

{{announcementContent}}

What this means for you:
{{impact}}

Questions? Contact us: {{supportEmail}}`,
    isDefault: false,
  },
];

export async function seedEmailTemplates(prisma: PrismaClient, userId: string): Promise<void> {
  console.log('Seeding email templates...');

  for (const template of emailTemplateSeedData) {
    await prisma.emailTemplate.create({
      data: {
        name: template.name,
        description: template.description,
        category: template.category,
        tags: template.tags,
        subject: template.subject,
        preheader: template.preheader,
        body: template.body,
        isDefault: template.isDefault,
        isPublic: true,
        createdBy: userId,
      },
    });
  }

  console.log(`Seeded ${emailTemplateSeedData.length} email templates`);
}
