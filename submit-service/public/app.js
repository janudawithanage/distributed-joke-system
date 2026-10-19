'use strict';

const { request, clearErrors, showErrors } = window.JokeUI;
const $ = id => document.getElementById(id);
const DRAFT_KEY = 'jokeplatform:submission-draft:v1';
let submitting = false;
let customOnly = false;

function updateCustomField(focus = false) {
  const custom = customOnly || $('typeSelect').value === '__custom__';
  $('custom-type-field').hidden = !custom;
  $('typeCustom').required = custom;
  $('typeSelect').required = !customOnly;
  if (custom && focus) $('typeCustom').focus();
}

async function loadTypes() {
  const select = $('typeSelect');
  try {
    const types = await request('/types');
    if (!Array.isArray(types)) throw new Error('Categories unavailable');
    select.replaceChildren(new Option('Choose a category', '', true, true));
    types.forEach(type => {
      select.add(new Option(type.name.charAt(0).toUpperCase() + type.name.slice(1), type.name));
    });
    select.add(new Option('Something new — create a category', '__custom__'));
  } catch (_) {
    customOnly = true;
    select.hidden = true;
    $('category-notice').hidden = false;
    document.querySelector('label[for="typeSelect"]').textContent = 'The category';
  }
  updateCustomField();
}

function updatePreview() {
  const setup = $('setup').value;
  const punchline = $('punchline').value;
  const type = customOnly || $('typeSelect').value === '__custom__' ? $('typeCustom').value : $('typeSelect').value;
  $('preview-setup').textContent = setup.trim() || 'Your setup takes the spotlight here.';
  $('preview-punchline').textContent = punchline.trim() || 'And this is where the punchline lands.';
  $('preview-type').textContent = type.trim() || 'Your kind of funny';
  for (const name of ['setup', 'punchline']) {
    const count = $(name).value.length;
    $(name + '-count').textContent = count;
    $(name + '-count').parentElement.classList.toggle('warn', count > 450);
  }
}

function saveDraft() {
  const draft = { setup: $('setup').value, punchline: $('punchline').value, type: $('typeSelect').value, custom: $('typeCustom').value };
  try {
    if (Object.values(draft).some(Boolean)) {
      localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
      $('draft-status').textContent = 'Draft saved on this device.';
    } else {
      localStorage.removeItem(DRAFT_KEY);
      $('draft-status').textContent = '';
    }
  } catch (_) { $('draft-status').textContent = ''; }
}

function restoreDraft() {
  try {
    const draft = JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null');
    if (!draft || typeof draft !== 'object') return;
    $('setup').value = typeof draft.setup === 'string' ? draft.setup.slice(0, 500) : '';
    $('punchline').value = typeof draft.punchline === 'string' ? draft.punchline.slice(0, 500) : '';
    $('typeCustom').value = typeof draft.custom === 'string' ? draft.custom.slice(0, 50) : '';
    if ([...$('typeSelect').options].some(option => option.value === draft.type)) {
      $('typeSelect').value = draft.type;
    } else if (draft.type && !customOnly) {
      $('typeSelect').value = '__custom__';
      $('typeCustom').value = draft.type;
    } else if (customOnly && draft.type && draft.type !== '__custom__') {
      $('typeCustom').value = draft.type;
    }
    $('draft-status').textContent = 'Your saved draft is ready.';
  } catch (_) { /* Storage can be unavailable in private browsing. */ }
}

function validateForm() {
  const errors = [];
  for (const [field, label] of [['setup', 'Add a setup to your joke.'], ['punchline', 'Add the punchline to your joke.']]) {
    if (!$(field).value.trim()) errors.push({ field, message: label });
    else if ($(field).value.trim().length > 500) errors.push({ field, message: 'Keep this to 500 characters or fewer.' });
  }
  const custom = customOnly || $('typeSelect').value === '__custom__';
  if (custom && !$('typeCustom').value.trim()) errors.push({ field: 'typeCustom', message: 'Give your new category a name.' });
  else if (!custom && !$('typeSelect').value) errors.push({ field: 'typeSelect', message: 'Choose a category for your joke.' });
  return errors;
}

async function submitJoke(event) {
  event?.preventDefault();
  if (submitting || $('submission-editor').hidden) return;
  $('alertBox').hidden = true;
  const errors = validateForm();
  if (errors.length) { showErrors($('submit-form'), errors); return; }
  clearErrors($('submit-form'));
  const payload = {
    setup: $('setup').value.trim(),
    punchline: $('punchline').value.trim(),
    type: (customOnly || $('typeSelect').value === '__custom__' ? $('typeCustom').value : $('typeSelect').value).trim().toLowerCase()
  };
  submitting = true;
  $('submitBtn').disabled = true;
  $('submitBtn').querySelector('.btn-text').textContent = 'Sending your joke…';
  $('submit-form').setAttribute('aria-busy', 'true');
  try {
    await request('/submit', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    try { localStorage.removeItem(DRAFT_KEY); } catch (_) {}
    $('submit-form').reset();
    $('typeCustom').value = '';
    updateCustomField();
    updatePreview();
    $('draft-status').textContent = '';
    $('submission-editor').hidden = true;
    $('submission-success').hidden = false;
    $('submission-success').focus();
  } catch (error) {
    $('alertBox').textContent = error.status === 429
      ? `A few too many jokes at once. Your draft is safe. Try again in ${error.retryAfter} seconds.`
      : error.status === 400
        ? error.message
        : 'Your joke hasn’t been sent. Check your connection and try again. Your draft is safe.';
    $('alertBox').hidden = false;
  } finally {
    submitting = false;
    $('submitBtn').disabled = false;
    $('submitBtn').querySelector('.btn-text').textContent = 'Send for review';
    $('submit-form').setAttribute('aria-busy', 'false');
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  $('submit-form').addEventListener('submit', submitJoke);
  $('submit-form').addEventListener('input', () => { updatePreview(); saveDraft(); });
  $('typeSelect').addEventListener('change', () => { updateCustomField(true); updatePreview(); saveDraft(); });
  $('submit-another').addEventListener('click', () => {
    $('submission-success').hidden = true;
    $('submission-editor').hidden = false;
    $('setup').focus();
  });
  document.addEventListener('keydown', event => {
    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
      event.preventDefault();
      submitJoke();
    }
  });
  await loadTypes();
  restoreDraft();
  updateCustomField();
  updatePreview();
});
