/**
 * Kling Forms Widget
 * Embeddable form widget for lead capture
 */
(function () {
  "use strict";

  // Get script element and configuration
  const currentScript = document.currentScript;
  const formId = currentScript?.getAttribute("data-form-id");
  const isInline = currentScript?.getAttribute("data-inline") === "true";
  const position = currentScript?.getAttribute("data-position") || "bottom-right";

  if (!formId) {
    console.error("[Kling] Missing data-form-id attribute");
    return;
  }

  // API base URL (required for cross-origin embedding)
  const apiBase = currentScript?.getAttribute("data-api");
  if (!apiBase) {
    console.error("[Kling] Missing data-api attribute. Please specify your API URL.");
    return;
  }

  // Storage keys
  const STORAGE_KEY = `kling_form_${formId}`;
  const getStorageKey = (suffix) => `${STORAGE_KEY}_${suffix}`;

  // State
  let formData = null;
  let isVisible = false;
  let container = null;
  let overlay = null;

  // Styles
  const styles = `
    .kling-overlay {
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, var(--kling-overlay-opacity, 0.5));
      z-index: 99999;
      display: flex;
      align-items: center;
      justify-content: center;
      opacity: 0;
      visibility: hidden;
      transition: opacity 0.2s ease-out, visibility 0.2s ease-out;
    }
    .kling-overlay.visible {
      opacity: 1;
      visibility: visible;
    }
    .kling-container {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      line-height: 1.5;
      box-sizing: border-box;
    }
    .kling-container * {
      box-sizing: border-box;
    }
    .kling-popup {
      background: var(--kling-bg, #fff);
      color: var(--kling-text, #000);
      border-radius: var(--kling-radius, 8px);
      padding: 24px;
      max-width: 420px;
      width: 90%;
      max-height: 90vh;
      overflow-y: auto;
      position: relative;
      transform: scale(0.95);
      opacity: 0;
      transition: transform 0.2s ease-out, opacity 0.2s ease-out;
      box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.25);
    }
    .kling-overlay.visible .kling-popup {
      transform: scale(1);
      opacity: 1;
    }
    .kling-flyout {
      position: fixed;
      bottom: 20px;
      right: 20px;
      background: var(--kling-bg, #fff);
      color: var(--kling-text, #000);
      border-radius: var(--kling-radius, 8px);
      padding: 20px;
      width: 320px;
      max-height: 80vh;
      overflow-y: auto;
      z-index: 99998;
      box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.25);
      transform: translateX(120%);
      opacity: 0;
      transition: transform 0.3s ease-out, opacity 0.3s ease-out;
    }
    .kling-flyout.visible {
      transform: translateX(0);
      opacity: 1;
    }
    .kling-flyout.position-bottom-left {
      right: auto;
      left: 20px;
      transform: translateX(-120%);
    }
    .kling-flyout.position-bottom-left.visible {
      transform: translateX(0);
    }
    .kling-banner {
      position: fixed;
      left: 0;
      right: 0;
      background: var(--kling-bg, #fff);
      color: var(--kling-text, #000);
      padding: 16px 24px;
      z-index: 99998;
      box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
      transform: translateY(-100%);
      opacity: 0;
      transition: transform 0.3s ease-out, opacity 0.3s ease-out;
    }
    .kling-banner.position-top {
      top: 0;
    }
    .kling-banner.position-bottom {
      top: auto;
      bottom: 0;
      transform: translateY(100%);
    }
    .kling-banner.visible {
      transform: translateY(0);
      opacity: 1;
    }
    .kling-embedded {
      background: var(--kling-bg, #fff);
      color: var(--kling-text, #000);
    }
    .kling-close {
      position: absolute;
      top: 12px;
      right: 12px;
      background: none;
      border: none;
      cursor: pointer;
      padding: 4px;
      color: inherit;
      opacity: 0.5;
      transition: opacity 0.2s;
    }
    .kling-close:hover {
      opacity: 1;
    }
    .kling-form {
      display: flex;
      flex-direction: column;
      gap: 16px;
    }
    .kling-field {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    .kling-field.half {
      width: 50%;
    }
    .kling-label {
      font-size: 14px;
      font-weight: 500;
    }
    .kling-required {
      color: #ef4444;
      margin-left: 2px;
    }
    .kling-input {
      padding: 10px 12px;
      border: 1px solid #d1d5db;
      border-radius: 6px;
      font-size: 14px;
      width: 100%;
      transition: border-color 0.2s, box-shadow 0.2s;
    }
    .kling-input:focus {
      outline: none;
      border-color: var(--kling-btn, #3b82f6);
      box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1);
    }
    .kling-input.error {
      border-color: #ef4444;
    }
    .kling-select {
      padding: 10px 12px;
      border: 1px solid #d1d5db;
      border-radius: 6px;
      font-size: 14px;
      width: 100%;
      background: #fff;
      cursor: pointer;
    }
    .kling-checkbox-wrapper {
      display: flex;
      align-items: flex-start;
      gap: 8px;
    }
    .kling-checkbox {
      margin-top: 2px;
    }
    .kling-help {
      font-size: 12px;
      color: #6b7280;
    }
    .kling-error {
      font-size: 12px;
      color: #ef4444;
    }
    .kling-paragraph {
      font-size: 14px;
      color: #4b5563;
      white-space: pre-wrap;
    }
    .kling-paragraph-title {
      font-size: 14px;
      font-weight: 500;
      margin-bottom: 4px;
    }
    .kling-captcha {
      background: #f3f4f6;
      border: 1px solid #d1d5db;
      border-radius: 6px;
      padding: 12px;
      text-align: center;
    }
    .kling-captcha-text {
      font-family: monospace;
      font-size: 24px;
      font-weight: bold;
      letter-spacing: 4px;
      color: #374151;
      user-select: none;
    }
    .kling-captcha img {
      max-width: 100%;
      height: auto;
    }
    .kling-submit {
      padding: 12px 24px;
      background: var(--kling-btn, #3b82f6);
      color: var(--kling-btn-text, #fff);
      border: none;
      border-radius: 6px;
      font-size: 14px;
      font-weight: 500;
      cursor: pointer;
      transition: opacity 0.2s;
    }
    .kling-submit:hover {
      opacity: 0.9;
    }
    .kling-submit:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }
    .kling-success {
      text-align: center;
      padding: 32px 16px;
    }
    .kling-success-icon {
      width: 48px;
      height: 48px;
      background: #dcfce7;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      margin: 0 auto 16px;
    }
    .kling-success-icon svg {
      width: 24px;
      height: 24px;
      color: #22c55e;
    }
    .kling-success-message {
      font-size: 18px;
      font-weight: 500;
    }
  `;

  // Inject styles
  function injectStyles() {
    if (document.getElementById("kling-styles")) return;
    const styleEl = document.createElement("style");
    styleEl.id = "kling-styles";
    styleEl.textContent = styles;
    document.head.appendChild(styleEl);
  }

  // Fetch form data
  async function fetchForm() {
    try {
      const response = await fetch(`${apiBase}/v1/public/forms/${formId}/config`);
      if (!response.ok) throw new Error("Form not found");
      const data = await response.json();
      return data.data?.form || data.form;
    } catch (error) {
      console.error("[Kling] Failed to load form:", error);
      return null;
    }
  }

  // Check display frequency
  function shouldDisplay(form) {
    const frequency = form.displayFrequency || "once_per_session";
    const lastShown = localStorage.getItem(getStorageKey("shown"));
    const submitted = localStorage.getItem(getStorageKey("submitted"));

    // Don't show if already submitted
    if (submitted) return false;

    if (frequency === "always") return true;

    if (frequency === "once_per_session") {
      return !sessionStorage.getItem(getStorageKey("shown"));
    }

    if (frequency === "once_per_day") {
      if (!lastShown) return true;
      const lastDate = new Date(parseInt(lastShown));
      const now = new Date();
      return lastDate.toDateString() !== now.toDateString();
    }

    return true;
  }

  // Check device targeting
  function matchesDevice(form) {
    const targeting = form.deviceTargeting || "all";
    if (targeting === "all") return true;

    const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
    if (targeting === "mobile") return isMobile;
    if (targeting === "desktop") return !isMobile;

    return true;
  }

  // Check URL targeting
  function matchesUrl(form) {
    const currentUrl = window.location.href;
    const displayOnUrls = form.displayOnUrls || [];
    const excludeUrls = form.excludeUrls || [];

    // Check exclusions first
    for (const pattern of excludeUrls) {
      if (matchUrlPattern(currentUrl, pattern)) return false;
    }

    // If no display URLs specified, show everywhere
    if (displayOnUrls.length === 0) return true;

    // Check display URLs
    for (const pattern of displayOnUrls) {
      if (matchUrlPattern(currentUrl, pattern)) return true;
    }

    return false;
  }

  function matchUrlPattern(url, pattern) {
    // Simple glob matching
    const regex = new RegExp(
      "^" + pattern.replace(/\*/g, ".*").replace(/\?/g, ".") + "$",
      "i"
    );
    return regex.test(url);
  }

  // Apply styling
  function applyStyles(element, styling) {
    if (!styling) return;
    element.style.setProperty("--kling-bg", styling.backgroundColor || "#fff");
    element.style.setProperty("--kling-text", styling.textColor || "#000");
    element.style.setProperty("--kling-btn", styling.buttonColor || "#3b82f6");
    element.style.setProperty("--kling-btn-text", styling.buttonTextColor || "#fff");
    element.style.setProperty("--kling-radius", `${styling.borderRadius || 8}px`);
    element.style.setProperty("--kling-overlay-opacity", styling.overlayOpacity || 0.5);
  }

  // Render field
  function renderField(id, entity, values, errors) {
    const { type, attributes } = entity;
    const label = attributes.label || "";
    const placeholder = attributes.placeholder || "";
    const helpText = attributes.helpText || "";
    const required = attributes.required;
    const width = attributes.width || "full";
    const options = attributes.options || [];

    let html = `<div class="kling-field ${width === "half" ? "half" : ""}">`;

    switch (type) {
      case "textField":
      case "emailField":
      case "phoneField":
        const inputType = type === "emailField" ? "email" : type === "phoneField" ? "tel" : "text";
        html += `
          <label class="kling-label">
            ${label}${required ? '<span class="kling-required">*</span>' : ""}
          </label>
          <input
            type="${inputType}"
            name="${id}"
            class="kling-input ${errors[id] ? "error" : ""}"
            placeholder="${placeholder}"
            value="${values[id] || ""}"
            ${required ? "required" : ""}
          />
          ${helpText ? `<span class="kling-help">${helpText}</span>` : ""}
          ${errors[id] ? `<span class="kling-error">${errors[id]}</span>` : ""}
        `;
        break;

      case "checkboxField":
        html += `
          <div class="kling-checkbox-wrapper">
            <input
              type="checkbox"
              name="${id}"
              class="kling-checkbox"
              ${values[id] ? "checked" : ""}
              ${required ? "required" : ""}
            />
            <label class="kling-label">
              ${label}${required ? '<span class="kling-required">*</span>' : ""}
            </label>
          </div>
          ${helpText ? `<span class="kling-help">${helpText}</span>` : ""}
          ${errors[id] ? `<span class="kling-error">${errors[id]}</span>` : ""}
        `;
        break;

      case "selectField":
        html += `
          <label class="kling-label">
            ${label}${required ? '<span class="kling-required">*</span>' : ""}
          </label>
          <select name="${id}" class="kling-select" ${required ? "required" : ""}>
            <option value="">${placeholder || "Select an option"}</option>
            ${options.map((opt) => `<option value="${opt.value}" ${values[id] === opt.value ? "selected" : ""}>${opt.label}</option>`).join("")}
          </select>
          ${helpText ? `<span class="kling-help">${helpText}</span>` : ""}
          ${errors[id] ? `<span class="kling-error">${errors[id]}</span>` : ""}
        `;
        break;

      case "paragraphField":
        const title = label && label !== "Paragraph" ? `<p class="kling-paragraph-title">${label}</p>` : "";
        html += `${title}<p class="kling-paragraph">${attributes.content || ""}</p>`;
        break;

      case "captchaField":
        html += `
          <label class="kling-label">
            ${label}<span class="kling-required">*</span>
          </label>
          <div class="kling-captcha" id="kling-captcha-${id}">
            <div class="kling-captcha-text">Loading...</div>
          </div>
          <input
            type="text"
            name="${id}"
            class="kling-input ${errors[id] ? "error" : ""}"
            placeholder="Enter the characters above"
            value="${values[id] || ""}"
            required
            autocomplete="off"
          />
          ${helpText ? `<span class="kling-help">${helpText}</span>` : ""}
          ${errors[id] ? `<span class="kling-error">${errors[id]}</span>` : ""}
        `;
        break;
    }

    html += "</div>";
    return html;
  }

  // Load captcha
  async function loadCaptcha(fieldId) {
    try {
      const response = await fetch(`${apiBase}/v1/public/forms/${formId}/captcha`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ formId }),
      });
      const data = await response.json();
      const captchaData = data.data || data;

      const captchaEl = document.getElementById(`kling-captcha-${fieldId}`);
      if (captchaEl && captchaData.svg) {
        captchaEl.innerHTML = captchaData.svg;
      }

      return captchaData.sessionId;
    } catch (error) {
      console.error("[Kling] Failed to load captcha:", error);
      return null;
    }
  }

  // Reload all captchas in the form
  function reloadCaptchas(form) {
    if (!form.schema?.root) return;

    form.schema.root.forEach((id) => {
      const entity = form.schema.entities[id];
      if (entity?.type === "captchaField") {
        loadCaptcha(id).then((sessionId) => {
          if (sessionId && container) {
            container.dataset.captchaSession = sessionId;
          }
        });
      }
    });
  }

  // Render form
  function renderForm(form, values = {}, errors = {}) {
    const schema = form.schema;
    if (!schema || !schema.root) return "<p>Form configuration error</p>";

    let fieldsHtml = schema.root
      .filter((id) => schema.entities[id])
      .map((id) => renderField(id, schema.entities[id], values, errors))
      .join("");

    return `
      <form class="kling-form" id="kling-form-${formId}">
        ${fieldsHtml}
        <button type="submit" class="kling-submit">Subscribe</button>
      </form>
    `;
  }

  // Render success
  function renderSuccess(message) {
    return `
      <div class="kling-success">
        <div class="kling-success-icon">
          <svg fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <p class="kling-success-message">${message || "Thank you for subscribing!"}</p>
      </div>
    `;
  }

  // Create container based on form type
  function createContainer(form) {
    injectStyles();

    // If data-inline is set, force embedded type regardless of form.type
    const type = isInline ? "embedded" : (form.type || "popup");

    if (type === "popup") {
      overlay = document.createElement("div");
      overlay.className = "kling-overlay";
      overlay.innerHTML = `
        <div class="kling-container kling-popup">
          <button class="kling-close" aria-label="Close">
            <svg width="20" height="20" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
          <div class="kling-content">${renderForm(form)}</div>
        </div>
      `;
      applyStyles(overlay, form.styling);
      document.body.appendChild(overlay);
      container = overlay.querySelector(".kling-popup");

      // Close on overlay click
      overlay.addEventListener("click", (e) => {
        if (e.target === overlay) hide();
      });

      // Close button
      overlay.querySelector(".kling-close").addEventListener("click", hide);
    } else if (type === "flyout") {
      container = document.createElement("div");
      container.className = `kling-container kling-flyout position-${position}`;
      container.innerHTML = `
        <button class="kling-close" aria-label="Close">
          <svg width="20" height="20" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
        <div class="kling-content">${renderForm(form)}</div>
      `;
      applyStyles(container, form.styling);
      document.body.appendChild(container);

      container.querySelector(".kling-close").addEventListener("click", hide);
    } else if (type === "banner") {
      container = document.createElement("div");
      const bannerPosition = position === "top" ? "position-top" : "position-bottom";
      container.className = `kling-container kling-banner ${bannerPosition}`;
      container.innerHTML = `
        <div style="max-width: 600px; margin: 0 auto;">
          <div class="kling-content">${renderForm(form)}</div>
        </div>
        <button class="kling-close" aria-label="Close">
          <svg width="20" height="20" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      `;
      applyStyles(container, form.styling);
      document.body.appendChild(container);

      container.querySelector(".kling-close").addEventListener("click", hide);
    } else if (type === "embedded") {
      // Find inline container or create one after the script tag
      let inlineContainer = document.getElementById(`kling-form-${formId}`);

      if (!inlineContainer && currentScript) {
        // Create container after the script tag
        inlineContainer = document.createElement("div");
        inlineContainer.id = `kling-form-${formId}`;
        currentScript.parentNode.insertBefore(inlineContainer, currentScript.nextSibling);
      }

      if (inlineContainer) {
        container = inlineContainer;
        container.className = "kling-container kling-embedded";
        container.innerHTML = `<div class="kling-content">${renderForm(form)}</div>`;
        applyStyles(container, form.styling);
        // Embedded forms are always visible, no show/hide needed
        isVisible = true;
      }
    }

    // Setup form handling
    setupFormHandling(form);

    // Load captchas after a brief delay to ensure DOM is ready
    setTimeout(() => reloadCaptchas(form), 100);
  }

  // Setup form handling
  function setupFormHandling(form) {
    const formEl = container?.querySelector(`#kling-form-${formId}`);
    if (!formEl) return;

    formEl.addEventListener("submit", async (e) => {
      e.preventDefault();

      const submitBtn = formEl.querySelector(".kling-submit");
      submitBtn.disabled = true;
      submitBtn.textContent = "Submitting...";

      const formData = new FormData(formEl);
      const values = {};
      const errors = {};

      // Collect values
      formData.forEach((value, key) => {
        values[key] = value;
      });

      // Handle checkboxes
      formEl.querySelectorAll('input[type="checkbox"]').forEach((cb) => {
        values[cb.name] = cb.checked;
      });

      // Validate
      let hasErrors = false;
      for (const id of form.schema.root) {
        const entity = form.schema.entities[id];
        if (!entity) continue;

        if (entity.type === "paragraphField") continue;

        if (entity.attributes.required && !values[id]) {
          errors[id] = "This field is required";
          hasErrors = true;
        }

        if (entity.type === "emailField" && values[id]) {
          const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
          if (!emailRegex.test(values[id])) {
            errors[id] = "Please enter a valid email";
            hasErrors = true;
          }
        }
      }

      if (hasErrors) {
        // Re-render with errors
        container.querySelector(".kling-content").innerHTML = renderForm(form, values, errors);
        setupFormHandling(form);
        // Reload captchas after re-render
        reloadCaptchas(form);
        return;
      }

      // Submit to API
      try {
        // Find captcha field and extract answer
        let captchaAnswer = null;
        for (const id of form.schema.root) {
          const entity = form.schema.entities[id];
          if (entity?.type === "captchaField" && values[id]) {
            captchaAnswer = values[id];
            break;
          }
        }

        const response = await fetch(`${apiBase}/v1/public/forms/${formId}/submit`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            data: values,
            captchaSessionId: container.dataset.captchaSession,
            captchaAnswer: captchaAnswer,
          }),
        });

        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(errorData.error?.message || "Submission failed");
        }

        // Success
        localStorage.setItem(getStorageKey("submitted"), "true");
        container.querySelector(".kling-content").innerHTML = renderSuccess(form.successMessage);

        // Redirect if configured
        if (form.successRedirect) {
          setTimeout(() => {
            window.location.href = form.successRedirect;
          }, 1500);
        }
      } catch (error) {
        console.error("[Kling] Submission failed:", error);
        errors._form = error.message;
        container.querySelector(".kling-content").innerHTML = renderForm(form, values, errors);
        setupFormHandling(form);
        // Reload captchas after re-render
        reloadCaptchas(form);
      }
    });
  }

  // Show form
  function show() {
    if (isVisible || !container) return;
    isVisible = true;

    sessionStorage.setItem(getStorageKey("shown"), "true");
    localStorage.setItem(getStorageKey("shown"), Date.now().toString());

    if (overlay) {
      overlay.classList.add("visible");
    } else if (container) {
      container.classList.add("visible");
    }
  }

  // Hide form
  function hide() {
    if (!isVisible) return;
    isVisible = false;

    if (overlay) {
      overlay.classList.remove("visible");
    } else if (container) {
      container.classList.remove("visible");
    }
  }

  // Setup triggers
  function setupTriggers(form) {
    const rules = form.triggerRules;
    if (!rules || !rules.type) {
      // Default: show after 1 second delay
      setTimeout(show, 1000);
      return;
    }

    switch (rules.type) {
      case "immediate":
        show();
        break;

      case "time_delay":
        setTimeout(show, (rules.value || 5) * 1000);
        break;

      case "scroll_depth":
        const scrollHandler = () => {
          const scrollPercent = (window.scrollY / (document.body.scrollHeight - window.innerHeight)) * 100;
          if (scrollPercent >= (rules.value || 50)) {
            show();
            window.removeEventListener("scroll", scrollHandler);
          }
        };
        window.addEventListener("scroll", scrollHandler);
        break;

      case "exit_intent":
        const exitHandler = (e) => {
          if (e.clientY <= 0) {
            show();
            document.removeEventListener("mouseout", exitHandler);
          }
        };
        document.addEventListener("mouseout", exitHandler);
        break;

      case "click":
        // Show form when element matching selector is clicked
        if (rules.selector) {
          const clickHandler = (e) => {
            const target = e.target.closest(rules.selector);
            if (target) {
              e.preventDefault();
              show();
            }
          };
          document.addEventListener("click", clickHandler);
        } else {
          console.warn("[Kling] Click trigger requires a selector");
        }
        break;

      default:
        // Unknown trigger type, show after delay
        setTimeout(show, 1000);
    }
  }

  // Initialize
  async function init() {
    formData = await fetchForm();
    if (!formData) return;

    // Check targeting
    if (!matchesDevice(formData)) return;
    if (!matchesUrl(formData)) return;

    // For inline forms, always render
    if (isInline || formData.type === "embedded") {
      createContainer(formData);
      show();
      return;
    }

    // Always create container so manual triggers can work
    createContainer(formData);

    // Check display frequency - only auto-show if allowed
    if (shouldDisplay(formData)) {
      setupTriggers(formData);
    }
  }

  // Public API
  window.KlingForms = window.KlingForms || {};
  window.KlingForms.show = function (id) {
    if (id === formId) show();
  };
  window.KlingForms.hide = function (id) {
    if (id === formId) hide();
  };
  window.KlingForms.reload = function (id) {
    if (id === formId) init();
  };

  // Start
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
