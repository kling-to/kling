/**
 * Upsale Forms Embed Script
 *
 * Embeds forms inline in page content.
 * Uses Shadow DOM for style isolation.
 */
(function (window, document) {
  'use strict';

  const UpsaleForms = {
    config: null,
    forms: {},

    /**
     * Initialize the forms manager
     */
    init: function (config) {
      this.config = config;
      console.log('[UpsaleForms] Initialized with config:', config);

      if (config.formId) {
        this.loadForm(config.formId);
      }
    },

    /**
     * Load a form by ID
     */
    loadForm: async function (formId) {
      try {
        const response = await fetch(
          `${this.config.apiUrl}/forms/${formId}/config`
        );
        if (!response.ok) {
          throw new Error('Form not found');
        }
        const responseData = await response.json();
        // Unwrap express-zod-api response format
        const formConfig = responseData.data || responseData;
        console.log('[UpsaleForms] Form loaded:', formId);
        this.forms[formId] = formConfig;
        this.renderForm(formId, formConfig);
      } catch (error) {
        console.error('[UpsaleForms] Failed to load form:', error.message);
      }
    },

    /**
     * Render form in target element
     */
    renderForm: function (formId, formConfig) {
      // Find target element
      const targetId = `upsale-form-${formId}`;
      let target = document.getElementById(targetId);

      if (!target) {
        console.error('[UpsaleForms] Target element not found:', targetId);
        return;
      }

      // Create shadow DOM for style isolation
      const shadow = target.attachShadow({ mode: 'open' });

      // Add styles
      shadow.innerHTML = `
        <style>${this.getStyles(formConfig)}</style>
        <div class="upsale-form-container">
          ${this.generateFormHTML(formId, formConfig)}
        </div>
      `;

      // Attach submit handler
      this.attachSubmitHandler(formId, formConfig, shadow);
      this.trackView(formId);
    },

    /**
     * Generate form HTML
     */
    generateFormHTML: function (formId, formConfig) {
      const design = formConfig.design || {};
      const fields = (formConfig.fields || []).sort((a, b) => a.order - b.order);

      let fieldsHTML = fields.map((field) => this.generateFieldHTML(field)).join('');

      // Add GDPR consent if required
      if (formConfig.gdprConsent) {
        fieldsHTML += `
          <div class="upsale-field upsale-field-checkbox">
            <label class="upsale-checkbox-label">
              <input type="checkbox" name="gdprConsent" required>
              <span>${formConfig.gdprLabel || 'I agree to receive marketing communications'}</span>
            </label>
          </div>
        `;
      }

      return `
        <form class="upsale-form" data-form-id="${formId}">
          ${fieldsHTML}
          <button type="submit" class="upsale-submit">
            ${design.submitButtonText || 'Submit'}
          </button>
        </form>
      `;
    },

    /**
     * Generate HTML for a single field
     */
    generateFieldHTML: function (field) {
      const required = field.required ? 'required' : '';
      const placeholder = field.placeholder
        ? `placeholder="${field.placeholder}"`
        : '';

      switch (field.type) {
        case 'email':
          return `
            <div class="upsale-field">
              <label for="${field.id}">${field.label}</label>
              <input type="email" id="${field.id}" name="${field.name}" ${placeholder} ${required}>
            </div>
          `;

        case 'phone':
          return `
            <div class="upsale-field">
              <label for="${field.id}">${field.label}</label>
              <input type="tel" id="${field.id}" name="${field.name}" ${placeholder} ${required}>
            </div>
          `;

        case 'text':
          return `
            <div class="upsale-field">
              <label for="${field.id}">${field.label}</label>
              <input type="text" id="${field.id}" name="${field.name}" ${placeholder} ${required}>
            </div>
          `;

        case 'textarea':
          return `
            <div class="upsale-field">
              <label for="${field.id}">${field.label}</label>
              <textarea id="${field.id}" name="${field.name}" ${placeholder} ${required}></textarea>
            </div>
          `;

        case 'select':
          const options = (field.options || [])
            .map((opt) => `<option value="${opt}">${opt}</option>`)
            .join('');
          return `
            <div class="upsale-field">
              <label for="${field.id}">${field.label}</label>
              <select id="${field.id}" name="${field.name}" ${required}>
                <option value="">Select...</option>
                ${options}
              </select>
            </div>
          `;

        case 'radio':
          const radioOptions = (field.options || [])
            .map(
              (opt, i) => `
              <label class="upsale-radio-option">
                <input type="radio" name="${field.name}" value="${opt}" ${i === 0 && field.required ? 'required' : ''}>
                <span>${opt}</span>
              </label>
            `
            )
            .join('');
          return `
            <div class="upsale-field upsale-field-radio">
              <label class="upsale-field-label">${field.label}</label>
              <div class="upsale-radio-group">${radioOptions}</div>
            </div>
          `;

        case 'checkbox':
          return `
            <div class="upsale-field upsale-field-checkbox">
              <label class="upsale-checkbox-label">
                <input type="checkbox" name="${field.name}" ${required}>
                <span>${field.label}</span>
              </label>
            </div>
          `;

        case 'date':
          return `
            <div class="upsale-field">
              <label for="${field.id}">${field.label}</label>
              <input type="date" id="${field.id}" name="${field.name}" ${required}>
            </div>
          `;

        case 'datetime':
          return `
            <div class="upsale-field">
              <label for="${field.id}">${field.label}</label>
              <input type="datetime-local" id="${field.id}" name="${field.name}" ${required}>
            </div>
          `;

        case 'number':
          return `
            <div class="upsale-field">
              <label for="${field.id}">${field.label}</label>
              <input type="number" id="${field.id}" name="${field.name}" ${placeholder} ${required}>
            </div>
          `;

        case 'hidden':
          return `<input type="hidden" name="${field.name}" value="${field.defaultValue || ''}">`;

        default:
          return `
            <div class="upsale-field">
              <label for="${field.id}">${field.label}</label>
              <input type="text" id="${field.id}" name="${field.name}" ${placeholder} ${required}>
            </div>
          `;
      }
    },

    /**
     * Attach submit handler
     */
    attachSubmitHandler: function (formId, formConfig, shadow) {
      const form = shadow.querySelector('.upsale-form');
      if (!form) return;

      form.addEventListener('submit', async (e) => {
        e.preventDefault();

        const submitBtn = form.querySelector('.upsale-submit');
        const originalText = submitBtn.textContent;
        submitBtn.disabled = true;
        submitBtn.textContent = 'Submitting...';

        // Clear previous errors
        const existingError = form.querySelector('.upsale-error');
        if (existingError) existingError.remove();

        // Collect form data
        const formData = new FormData(form);
        const data = {};
        let gdprConsent = false;

        formData.forEach((value, key) => {
          if (key === 'gdprConsent') {
            gdprConsent = true;
          } else {
            data[key] = value;
          }
        });

        try {
          const response = await fetch(
            `${this.config.apiUrl}/forms/${formId}/submit`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                data,
                source: {
                  page: window.location.pathname,
                  referrer: document.referrer,
                  userAgent: navigator.userAgent,
                },
                variantName: formConfig.variantName,
                gdprConsent,
              }),
            }
          );

          const responseData = await response.json();
          // Unwrap express-zod-api response format
          const result = responseData.data || responseData;

          if (response.ok && result.success !== false) {
            // Show thank you message
            const container = shadow.querySelector('.upsale-form-container');
            const thankYouMsg =
              formConfig.design?.thankYouMessage || 'Thank you for your submission!';
            container.innerHTML = `
              <div class="upsale-thank-you">
                <svg class="upsale-success-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
                  <polyline points="22 4 12 14.01 9 11.01"></polyline>
                </svg>
                <p>${thankYouMsg}</p>
              </div>
            `;
          } else {
            throw new Error(result.message || 'Submission failed');
          }
        } catch (error) {
          submitBtn.disabled = false;
          submitBtn.textContent = originalText;

          const errorEl = document.createElement('p');
          errorEl.className = 'upsale-error';
          errorEl.textContent = error.message;
          form.insertBefore(errorEl, submitBtn);
        }
      });
    },

    /**
     * Track form view
     */
    trackView: function (formId) {
      // Fire and forget - don't block rendering
      fetch(`${this.config.apiUrl}/forms/${formId}/analytics`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ event: 'view' }),
      }).catch(() => {});
    },

    /**
     * Get CSS styles
     */
    getStyles: function (formConfig) {
      const design = formConfig.design || {};
      const primaryColor = design.primaryColor || '#2563eb';

      return `
        .upsale-form-container {
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
          font-size: 14px;
          line-height: 1.5;
          color: #1f2937;
        }

        .upsale-form {
          display: flex;
          flex-direction: column;
          gap: 16px;
        }

        .upsale-field {
          display: flex;
          flex-direction: column;
          gap: 6px;
        }

        .upsale-field label {
          font-weight: 500;
          color: #374151;
        }

        .upsale-field input[type="text"],
        .upsale-field input[type="email"],
        .upsale-field input[type="tel"],
        .upsale-field input[type="number"],
        .upsale-field input[type="date"],
        .upsale-field input[type="datetime-local"],
        .upsale-field textarea,
        .upsale-field select {
          padding: 10px 12px;
          border: 1px solid #d1d5db;
          border-radius: 6px;
          font-size: 14px;
          transition: border-color 0.15s, box-shadow 0.15s;
          background: white;
        }

        .upsale-field input:focus,
        .upsale-field textarea:focus,
        .upsale-field select:focus {
          outline: none;
          border-color: ${primaryColor};
          box-shadow: 0 0 0 3px ${primaryColor}20;
        }

        .upsale-field textarea {
          min-height: 80px;
          resize: vertical;
        }

        .upsale-field-radio .upsale-field-label {
          margin-bottom: 8px;
        }

        .upsale-radio-group {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
        }

        .upsale-radio-option {
          display: flex;
          align-items: center;
          gap: 6px;
          cursor: pointer;
          padding: 6px 12px;
          border: 1px solid #d1d5db;
          border-radius: 6px;
          transition: border-color 0.15s, background 0.15s;
        }

        .upsale-radio-option:hover {
          border-color: ${primaryColor};
        }

        .upsale-radio-option:has(input:checked) {
          border-color: ${primaryColor};
          background: ${primaryColor}10;
        }

        .upsale-checkbox-label {
          display: flex;
          align-items: flex-start;
          gap: 8px;
          cursor: pointer;
        }

        .upsale-checkbox-label input {
          margin-top: 2px;
        }

        .upsale-submit {
          padding: 12px 24px;
          background: ${primaryColor};
          color: white;
          border: none;
          border-radius: 6px;
          font-size: 14px;
          font-weight: 500;
          cursor: pointer;
          transition: background 0.15s;
        }

        .upsale-submit:hover:not(:disabled) {
          filter: brightness(0.9);
        }

        .upsale-submit:disabled {
          opacity: 0.6;
          cursor: not-allowed;
        }

        .upsale-error {
          color: #dc2626;
          font-size: 13px;
          margin: 0;
          padding: 8px 12px;
          background: #fef2f2;
          border-radius: 6px;
        }

        .upsale-thank-you {
          text-align: center;
          padding: 24px;
        }

        .upsale-success-icon {
          width: 48px;
          height: 48px;
          color: #10b981;
          margin-bottom: 12px;
        }

        .upsale-thank-you p {
          color: #374151;
          margin: 0;
        }
      `;
    },
  };

  // Expose to global scope
  window.upsaleForms = function (action, config) {
    switch (action) {
      case 'init':
        UpsaleForms.init(config);
        break;
      case 'load':
        if (config.formId) {
          UpsaleForms.loadForm(config.formId);
        }
        break;
    }
  };

  // Process queued commands
  if (window.upsaleForms && window.upsaleForms.q) {
    window.upsaleForms.q.forEach(function (args) {
      window.upsaleForms.apply(null, args);
    });
  }
})(window, document);
