'use strict';

window.JokeUI = (() => {
  const config = window.APP_CONFIG || {};
  const localService = ['localhost', '127.0.0.1'].includes(location.hostname) && ['3100', '3200', '3300'].includes(location.port);
  const fallback = localService ? `${location.protocol}//${location.hostname}:8000` : window.location.origin;
  const gateway = (config.gatewayBase || config.azureBase || config.localBase || fallback).replace(/\/$/, '');
  let toastTimer;

  function icon(name, className = '') {
    return `<svg class="icon ${className}" aria-hidden="true"><use href="icons.svg#${name}"></use></svg>`;
  }

  function toast(message) {
    const el = document.getElementById('toast');
    if (!el) return;
    clearTimeout(toastTimer);
    el.textContent = message;
    el.hidden = false;
    toastTimer = setTimeout(() => { el.hidden = true; el.textContent = ''; }, 5000);
  }

  // Timeouts make an interrupted connection recoverable without reloading.
  async function request(path, options = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12000);
    try {
      const response = await fetch(`${gateway}${path}`, { ...options, signal: controller.signal });
      const data = response.status === 204 ? null : await response.json().catch(() => null);
      if (!response.ok) {
        const error = new Error(data?.error || data?.message || 'Something went wrong. Please try again.');
        error.status = response.status;
        error.retryAfter = Math.max(1, Number(response.headers.get('Retry-After')) || 60);
        throw error;
      }
      if (response.status !== 204 && data === null) throw new Error('The server returned an unexpected response. Please try again.');
      return data;
    } finally {
      clearTimeout(timer);
    }
  }

  function clearErrors(form) {
    form.querySelectorAll('[aria-invalid]').forEach(el => el.removeAttribute('aria-invalid'));
    form.querySelectorAll('.field-error').forEach(el => { el.hidden = true; el.textContent = ''; });
    const summary = form.querySelector('[data-error-summary]');
    if (summary) { summary.hidden = true; summary.replaceChildren(); }
  }

  function showErrors(form, errors) {
    clearErrors(form);
    const summary = form.querySelector('[data-error-summary]');
    const title = document.createElement('strong');
    title.textContent = 'A few things need your attention:';
    const list = document.createElement('ul');
    errors.forEach(({ field, message }) => {
      const input = document.getElementById(field);
      input.setAttribute('aria-invalid', 'true');
      const inline = document.getElementById(`${field}-error`);
      if (inline) { inline.hidden = false; inline.textContent = message; }
      const item = document.createElement('li');
      item.dataset.field = field;
      const link = document.createElement('a');
      link.href = `#${field}`;
      link.textContent = message;
      link.addEventListener('click', event => { event.preventDefault(); input.focus(); });
      item.append(link);
      list.append(item);
    });
    summary.append(title, list);
    summary.hidden = false;
    summary.focus();
  }

  document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('[data-route]').forEach(link => { link.href = `${gateway}${link.dataset.route}`; });
    document.querySelectorAll('a[href="#main"]').forEach(link => {
      link.addEventListener('click', () => { document.getElementById('main')?.focus({ preventScroll: true }); });
    });
    document.querySelectorAll('form').forEach(form => {
      form.addEventListener('input', event => {
        const input = event.target;
        if (!input.id || !input.value?.trim() || input.getAttribute('aria-invalid') !== 'true') return;
        input.removeAttribute('aria-invalid');
        const inline = document.getElementById(`${input.id}-error`);
        if (inline) inline.hidden = true;
        const summary = form.querySelector('[data-error-summary]');
        summary?.querySelector(`li[data-field="${input.id}"]`)?.remove();
        if (summary && !summary.querySelector('li')) summary.hidden = true;
      });
    });
  });

  return { gateway, icon, toast, request, clearErrors, showErrors };
})();
