const SENSITIVE_PATTERN = /(ssn|social|credit|card|payment|bank|routing|password|secret|cvv|cvc|token|dob|birth|salary|compensation|race|ethnicity|disability|medical|health|diagnosis|passport|driver'?s?\s*license|license number|tax id|upload|attachment|confidential)/i;
const PICK_STYLE_ID = "grantflow-pick-style";
let pickCleanup = null;

function textForLabel(element) {
  if (element.id) {
    const label = document.querySelector(`label[for="${CSS.escape(element.id)}"]`);
    if (label) return label.textContent.trim();
  }
  const wrappingLabel = element.closest("label");
  if (wrappingLabel) return wrappingLabel.textContent.trim();
  const container = element.closest(".form-section, .field-row, section, div");
  const nearbyLabel = container?.querySelector("label");
  return nearbyLabel?.textContent.trim() || "";
}

function isEditableElement(element) {
  return element?.isContentEditable || element?.getAttribute?.("contenteditable") === "true";
}

function textForContext(element) {
  const container = element.closest(".form-section, .field-row, section, div");
  if (!container) return "";
  return [...container.querySelectorAll("label, p, h2, h3")]
    .map((node) => node.textContent.trim())
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .slice(0, 500);
}

function isSupportedField(element) {
  if (element.disabled || element.readOnly) return false;
  if (isEditableElement(element)) return true;
  if (element.tagName === "TEXTAREA") return true;
  if (element.tagName !== "INPUT") return false;
  const type = (element.getAttribute("type") || "text").toLowerCase();
  return ["text", "search", "url", "email", ""].includes(type);
}

function skipReason(element) {
  if (element.type === "hidden") return "hidden field";
  if (element.tagName === "INPUT" && element.type === "file") return "file upload";
  const probe = [
    element.name,
    element.id,
    element.placeholder,
    element.getAttribute("autocomplete"),
    element.getAttribute("aria-label"),
    textForLabel(element)
  ].filter(Boolean).join(" ");
  if (SENSITIVE_PATTERN.test(probe)) return "sensitive-looking field";
  return "";
}

function shouldSkip(element) {
  return Boolean(skipReason(element));
}

function selectorFor(element, index) {
  if (element.id) return `#${CSS.escape(element.id)}`;
  if (element.name) return `${element.tagName.toLowerCase()}[name="${CSS.escape(element.name)}"]`;
  element.dataset.grantflowKey = element.dataset.grantflowKey || `grantflow-${index}`;
  return `[data-grantflow-key="${element.dataset.grantflowKey}"]`;
}

function scanFields() {
  return scanFieldReport().fields;
}

function scanFieldReport() {
  const candidates = [...document.querySelectorAll("input, textarea, [contenteditable='true']")];
  const skipped = [];
  const fields = [];
  candidates.forEach((element, index) => {
    if (!isSupportedField(element)) return;
    const reason = skipReason(element);
    if (reason) {
      skipped.push({
        id: element.id || "",
        name: element.name || "",
        label: textForLabel(element),
        reason
      });
      return;
    }
    fields.push(fieldData(element, index));
  });
  return { fields, skipped };
}

function fieldData(element, index = 0) {
  return {
    key: selectorFor(element, index),
    id: element.id || "",
    name: element.name || "",
    type: isEditableElement(element) ? "contenteditable" : element.tagName === "TEXTAREA" ? "textarea" : element.type || "text",
    label: textForLabel(element),
    placeholder: element.placeholder || "",
    context: textForContext(element),
    maxLength: element.maxLength > 0 ? element.maxLength : 0,
    value: isEditableElement(element) ? element.textContent || "" : element.value || ""
  };
}

function setFieldValue(element, value) {
  if (isEditableElement(element)) {
    element.textContent = value;
    element.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: value }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
    return;
  }
  const prototype = element.tagName === "TEXTAREA"
    ? window.HTMLTextAreaElement.prototype
    : window.HTMLInputElement.prototype;
  const descriptor = Object.getOwnPropertyDescriptor(prototype, "value");
  if (descriptor?.set) {
    descriptor.set.call(element, value);
  } else {
    element.value = value;
  }
  element.dispatchEvent(new Event("input", { bubbles: true }));
  element.dispatchEvent(new Event("change", { bubbles: true }));
}

function fillFields(drafts) {
  let filled = 0;
  for (const draft of drafts || []) {
    const element = document.querySelector(draft.key);
    if (!element || !isSupportedField(element) || shouldSkip(element)) continue;
    setFieldValue(element, draft.answer || "");
    filled += 1;
  }
  return filled;
}

function installPickStyle() {
  if (document.getElementById(PICK_STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = PICK_STYLE_ID;
  style.textContent = `
    .grantflow-pick-active * { cursor: crosshair !important; }
    .grantflow-pick-hover {
      outline: 2px solid #246b5f !important;
      outline-offset: 3px !important;
      background-color: rgba(36, 107, 95, 0.08) !important;
    }
    .grantflow-pick-note {
      position: fixed;
      z-index: 2147483647;
      left: 12px;
      bottom: 12px;
      max-width: min(420px, calc(100vw - 24px));
      padding: 10px 12px;
      border-radius: 8px;
      background: #172126;
      color: #fff;
      font: 13px/1.4 Arial, sans-serif;
      box-shadow: 0 8px 24px rgba(0,0,0,0.25);
    }
  `;
  document.documentElement.appendChild(style);
}

function questionTextFromNode(node) {
  const element = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
  const prompt = element?.closest("label, legend, p, h1, h2, h3, h4, .question, .prompt, .form-section, .field-row");
  const container = prompt || element?.closest(".form-section, .field-row, fieldset, section, div") || element;
  return (container?.textContent || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 700);
}

function nearestField(target) {
  const fields = [...document.querySelectorAll("input, textarea, [contenteditable='true']")]
    .filter(isSupportedField)
    .filter((element) => !shouldSkip(element));
  const container = target.closest?.(".form-section, .field-row, fieldset, section, div");
  const contained = fields.find((field) => container?.contains(field));
  if (contained) return fieldData(contained, fields.indexOf(contained));

  const targetRect = target.getBoundingClientRect?.() || { top: 0, left: 0, bottom: 0 };
  let best = null;
  let bestScore = Infinity;
  fields.forEach((field, index) => {
    const rect = field.getBoundingClientRect();
    const vertical = Math.abs(rect.top - targetRect.bottom);
    const horizontal = Math.abs(rect.left - targetRect.left) * 0.15;
    const afterBonus = rect.top >= targetRect.top - 30 ? 0 : 250;
    const score = vertical + horizontal + afterBonus;
    if (score < bestScore) {
      bestScore = score;
      best = fieldData(field, index);
    }
  });
  return best;
}

function pickQuestion(sendResponse) {
  if (pickCleanup) pickCleanup();
  installPickStyle();
  document.documentElement.classList.add("grantflow-pick-active");
  const note = document.createElement("div");
  note.className = "grantflow-pick-note";
  note.textContent = "GrantFlow Pick & Fill: click or highlight a grant question. GrantFlow will draft and fill the matching field. Press Esc to cancel.";
  document.body.appendChild(note);
  let hoverTarget = null;
  let finished = false;

  const cleanup = () => {
    document.documentElement.classList.remove("grantflow-pick-active");
    hoverTarget?.classList.remove("grantflow-pick-hover");
    note.remove();
    document.removeEventListener("mouseover", onHover, true);
    document.removeEventListener("click", onClick, true);
    document.removeEventListener("mouseup", onMouseUp, true);
    document.removeEventListener("keydown", onKeyDown, true);
    pickCleanup = null;
  };
  const finish = (payload) => {
    if (finished) return;
    finished = true;
    cleanup();
    sendResponse(payload);
  };
  const onHover = (event) => {
    const target = event.target.closest?.("label, legend, p, h1, h2, h3, h4, .question, .prompt, .form-section, .field-row") || event.target;
    if (hoverTarget === target) return;
    hoverTarget?.classList.remove("grantflow-pick-hover");
    hoverTarget = target;
    hoverTarget?.classList.add("grantflow-pick-hover");
  };
  const onClick = (event) => {
    event.preventDefault();
    event.stopPropagation();
    const target = event.target;
    const field = nearestField(target);
    const question = questionTextFromNode(target) || field?.context || field?.label || "Selected grant question";
    finish({ question, field, url: location.href });
  };
  const onMouseUp = (event) => {
    setTimeout(() => {
      const selection = window.getSelection();
      const question = String(selection?.toString() || "").replace(/\s+/g, " ").trim();
      if (question.length < 8) return;
      const node = selection.anchorNode?.nodeType === Node.ELEMENT_NODE
        ? selection.anchorNode
        : selection.anchorNode?.parentElement || event.target;
      const field = nearestField(node);
      finish({ question: question.slice(0, 700), field, url: location.href });
      selection.removeAllRanges();
    }, 0);
  };
  const onKeyDown = (event) => {
    if (event.key !== "Escape") return;
    finish({ cancelled: true });
  };

  pickCleanup = cleanup;
  document.addEventListener("mouseover", onHover, true);
  document.addEventListener("click", onClick, true);
  document.addEventListener("mouseup", onMouseUp, true);
  document.addEventListener("keydown", onKeyDown, true);
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === "GRANTFLOW_SCAN") {
    sendResponse({ ...scanFieldReport(), url: location.href });
    return true;
  }
  if (message.type === "GRANTFLOW_READ_VALUES") {
    sendResponse({ ...scanFieldReport(), url: location.href });
    return true;
  }
  if (message.type === "GRANTFLOW_FILL") {
    sendResponse({ filled: fillFields(message.drafts) });
    return true;
  }
  if (message.type === "GRANTFLOW_PICK_QUESTION") {
    pickQuestion(sendResponse);
    return true;
  }
  return false;
});
