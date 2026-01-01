/**
 * Form Templates
 *
 * Pre-built form templates for common use cases.
 * Templates provide a starting point that users can customize.
 */
/**
 * Generate a unique field ID
 */
function fieldId() {
    return `field_${Math.random().toString(36).substring(2, 9)}`;
}
export const FORM_TEMPLATES = [
    {
        id: 'newsletter-simple',
        name: 'Simple Newsletter Signup',
        description: 'Classic email capture popup with minimal friction',
        category: 'newsletter',
        config: {
            displayType: 'embedded',
            fields: [
                {
                    id: fieldId(),
                    type: 'email',
                    name: 'email',
                    label: 'Email Address',
                    placeholder: 'you@example.com',
                    required: true,
                    order: 0,
                },
            ],
            triggers: {
                type: 'time_delay',
                config: { delaySeconds: 5, showOnce: true },
            },
            design: {
                theme: 'light',
                submitButtonText: 'Subscribe',
                thankYouMessage: 'Thanks for subscribing! Check your email to confirm.',
                position: 'center',
                showCloseButton: true,
            },
            gdprConsent: true,
            gdprLabel: 'I agree to receive marketing emails',
        },
    },
    {
        id: 'lead-magnet-ebook',
        name: 'eBook Download',
        description: 'Capture leads with a free content offer',
        category: 'lead_magnet',
        config: {
            displayType: 'embedded',
            fields: [
                {
                    id: fieldId(),
                    type: 'text',
                    name: 'firstName',
                    label: 'First Name',
                    placeholder: 'John',
                    required: true,
                    order: 0,
                },
                {
                    id: fieldId(),
                    type: 'email',
                    name: 'email',
                    label: 'Email Address',
                    placeholder: 'you@example.com',
                    required: true,
                    order: 1,
                },
            ],
            triggers: {
                type: 'exit_intent',
                config: { showOnce: true },
            },
            design: {
                theme: 'dark',
                submitButtonText: 'Download Free eBook',
                thankYouMessage: 'Check your email for the download link!',
                position: 'center',
                showCloseButton: true,
            },
            gdprConsent: true,
            gdprLabel: 'I agree to receive updates and promotional emails',
        },
    },
    {
        id: 'exit-intent-discount',
        name: 'Exit Intent Discount',
        description: 'Last-chance offer when visitor tries to leave',
        category: 'lead_magnet',
        config: {
            displayType: 'embedded',
            fields: [
                {
                    id: fieldId(),
                    type: 'email',
                    name: 'email',
                    label: 'Email Address',
                    placeholder: 'you@example.com',
                    required: true,
                    order: 0,
                },
            ],
            triggers: {
                type: 'exit_intent',
                config: { showOnce: true },
            },
            design: {
                theme: 'custom',
                primaryColor: '#FF6B6B',
                submitButtonText: 'Get 10% Off',
                thankYouMessage: 'Check your email for your discount code!',
                position: 'center',
                showCloseButton: true,
            },
            gdprConsent: true,
            gdprLabel: 'I agree to receive marketing emails',
        },
    },
    {
        id: 'contact-form',
        name: 'Contact Form',
        description: 'Embedded contact form for support inquiries',
        category: 'contact',
        config: {
            displayType: 'embedded',
            fields: [
                {
                    id: fieldId(),
                    type: 'text',
                    name: 'name',
                    label: 'Name',
                    placeholder: 'Your name',
                    required: true,
                    order: 0,
                },
                {
                    id: fieldId(),
                    type: 'email',
                    name: 'email',
                    label: 'Email',
                    placeholder: 'you@example.com',
                    required: true,
                    order: 1,
                },
                {
                    id: fieldId(),
                    type: 'text',
                    name: 'subject',
                    label: 'Subject',
                    placeholder: 'How can we help?',
                    required: true,
                    order: 2,
                },
                {
                    id: fieldId(),
                    type: 'textarea',
                    name: 'message',
                    label: 'Message',
                    placeholder: 'Your message...',
                    required: true,
                    order: 3,
                },
            ],
            triggers: {
                type: 'immediate',
                config: {},
            },
            design: {
                theme: 'light',
                submitButtonText: 'Send Message',
                thankYouMessage: "Thanks! We'll get back to you soon.",
                showCloseButton: false,
            },
        },
    },
    {
        id: 'webinar-registration',
        name: 'Webinar Registration',
        description: 'Capture attendees for live events',
        category: 'event',
        config: {
            displayType: 'embedded',
            fields: [
                {
                    id: fieldId(),
                    type: 'text',
                    name: 'firstName',
                    label: 'First Name',
                    placeholder: 'John',
                    required: true,
                    order: 0,
                },
                {
                    id: fieldId(),
                    type: 'text',
                    name: 'lastName',
                    label: 'Last Name',
                    placeholder: 'Doe',
                    required: true,
                    order: 1,
                },
                {
                    id: fieldId(),
                    type: 'email',
                    name: 'email',
                    label: 'Work Email',
                    placeholder: 'you@company.com',
                    required: true,
                    order: 2,
                },
                {
                    id: fieldId(),
                    type: 'text',
                    name: 'company',
                    label: 'Company',
                    placeholder: 'Acme Inc.',
                    required: false,
                    order: 3,
                },
            ],
            triggers: {
                type: 'immediate',
                config: {},
            },
            design: {
                theme: 'light',
                submitButtonText: 'Register Now',
                thankYouMessage: "You're registered! Check your email for details.",
                showCloseButton: false,
            },
            gdprConsent: true,
            gdprLabel: 'I agree to receive event reminders and updates',
        },
    },
    {
        id: 'feedback-nps',
        name: 'NPS Survey',
        description: 'Measure customer satisfaction with Net Promoter Score',
        category: 'feedback',
        config: {
            displayType: 'embedded',
            fields: [
                {
                    id: fieldId(),
                    type: 'radio',
                    name: 'score',
                    label: 'How likely are you to recommend us?',
                    required: true,
                    order: 0,
                    options: ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10'],
                },
                {
                    id: fieldId(),
                    type: 'textarea',
                    name: 'feedback',
                    label: 'Any comments?',
                    placeholder: 'Tell us more...',
                    required: false,
                    order: 1,
                },
                {
                    id: fieldId(),
                    type: 'email',
                    name: 'email',
                    label: 'Email (optional)',
                    placeholder: 'you@example.com',
                    required: false,
                    order: 2,
                },
            ],
            triggers: {
                type: 'page_views',
                config: { pageViewCount: 3, showOnce: true },
            },
            design: {
                theme: 'light',
                submitButtonText: 'Submit',
                thankYouMessage: 'Thanks for your feedback!',
                position: 'bottom-right',
                showCloseButton: true,
            },
        },
    },
    {
        id: 'mobile-app-promo',
        name: 'Mobile App Promotion',
        description: 'Promote app download on mobile devices',
        category: 'lead_magnet',
        config: {
            displayType: 'embedded',
            fields: [
                {
                    id: fieldId(),
                    type: 'phone',
                    name: 'phone',
                    label: 'Phone Number',
                    placeholder: '+1 555 123 4567',
                    required: true,
                    order: 0,
                },
            ],
            triggers: {
                type: 'time_delay',
                config: { delaySeconds: 3, showOnce: true },
            },
            targeting: {
                devices: ['mobile'],
            },
            design: {
                theme: 'dark',
                submitButtonText: 'Send Me the App',
                thankYouMessage: 'Check your SMS for the download link!',
                position: 'bottom-right',
                showCloseButton: true,
            },
        },
    },
    {
        id: 'early-access',
        name: 'Early Access Signup',
        description: 'Waitlist for product launches',
        category: 'newsletter',
        config: {
            displayType: 'embedded',
            fields: [
                {
                    id: fieldId(),
                    type: 'email',
                    name: 'email',
                    label: 'Email Address',
                    placeholder: 'you@example.com',
                    required: true,
                    order: 0,
                },
                {
                    id: fieldId(),
                    type: 'select',
                    name: 'interest',
                    label: "I'm interested in...",
                    required: true,
                    order: 1,
                    options: ['Feature A', 'Feature B', 'Feature C', 'All of them!'],
                },
            ],
            triggers: {
                type: 'immediate',
                config: {},
            },
            design: {
                theme: 'custom',
                primaryColor: '#4A90E2',
                submitButtonText: 'Join Waitlist',
                thankYouMessage: "You're on the list! We'll notify you when we launch.",
                showCloseButton: false,
            },
            gdprConsent: true,
            gdprLabel: 'I agree to receive product updates',
        },
    },
    {
        id: 'quiz-lead-gen',
        name: 'Interactive Quiz',
        description: 'Multi-question lead capture with personalized results',
        category: 'lead_magnet',
        config: {
            displayType: 'embedded',
            fields: [
                {
                    id: fieldId(),
                    type: 'radio',
                    name: 'q1',
                    label: "What's your biggest challenge?",
                    required: true,
                    order: 0,
                    options: ['Sales', 'Marketing', 'Support', 'Product'],
                },
                {
                    id: fieldId(),
                    type: 'select',
                    name: 'q2',
                    label: 'Company size?',
                    required: true,
                    order: 1,
                    options: ['1-10', '11-50', '51-200', '200+'],
                },
                {
                    id: fieldId(),
                    type: 'email',
                    name: 'email',
                    label: 'Email (to see results)',
                    placeholder: 'you@example.com',
                    required: true,
                    order: 2,
                },
            ],
            triggers: {
                type: 'scroll_depth',
                config: { scrollPercent: 50, showOnce: true },
            },
            design: {
                theme: 'light',
                submitButtonText: 'See My Results',
                thankYouMessage: 'Check your email for personalized recommendations!',
                position: 'center',
                showCloseButton: true,
            },
            gdprConsent: true,
            gdprLabel: 'I agree to receive personalized recommendations',
        },
    },
    {
        id: 'blog-subscribe',
        name: 'Blog Subscription',
        description: 'Minimal inline blog signup',
        category: 'newsletter',
        config: {
            displayType: 'embedded',
            fields: [
                {
                    id: fieldId(),
                    type: 'email',
                    name: 'email',
                    label: 'Email Address',
                    placeholder: 'you@example.com',
                    required: true,
                    order: 0,
                },
            ],
            triggers: {
                type: 'immediate',
                config: {},
            },
            design: {
                theme: 'light',
                submitButtonText: 'Subscribe to Blog',
                thankYouMessage: "Subscribed! You'll get our weekly digest.",
                showCloseButton: false,
            },
            gdprConsent: true,
            gdprLabel: 'I agree to receive blog updates',
        },
    },
];
/**
 * Get a form template by ID
 */
export function getFormTemplate(templateId) {
    return FORM_TEMPLATES.find((t) => t.id === templateId);
}
/**
 * Get templates by category
 */
export function getTemplatesByCategory(category) {
    return FORM_TEMPLATES.filter((t) => t.category === category);
}
