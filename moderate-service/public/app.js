'use strict';

const { request, icon, toast, showErrors, clearErrors, gateway } = window.JokeUI;
const $ = id => document.getElementById(id);
const stats = { approved: 0, rejected: 0 };
let pollTimer;
let pollDelay = 1500;
let fetching = false;
let processing = false;
let paused = false;
let authBlocked = false;
let currentJoke = null;

function connection(label, healthy = true) {
  $('queue-connection').lastElementChild.textContent = label;
  $('queue-connection').style.color = healthy ? 'var(--green)' : 'var(--danger)';
}

function status(title, description) {
  $('status-title').textContent = title;
  $('status-text').textContent = description;
}

function blockSession(error) {
  authBlocked = true;
  clearTimeout(pollTimer);
  connection('Sign-in required', false);
  status(error.status === 403 ? 'A moderator account is needed.' : 'Your desk is ready.',
    error.status === 403 ? 'Your account does not have permission to review submissions.' : 'Sign in to your moderator account to start reviewing.');
  $('login-link').textContent = error.status === 403 ? 'Switch account' : 'Sign in to continue';
  $('login-link').hidden = false;
  if (currentJoke) {
    $('review-error').replaceChildren(document.createTextNode(error.status === 403
      ? 'Your account does not have permission to review this joke. '
      : 'Your session has expired. Your edits are still here. '));
    const link = document.createElement('a');
    link.href = `${gateway}/login`;
    link.textContent = 'Sign in again';
    $('review-error').append(link);
    $('review-error').hidden = false;
  }
}

async function loadProfile() {
  try {
    const user = await request('/me');
    $('user-info').hidden = false;
    $('user-name').textContent = user.name || user.email || 'Moderator';
    $('user-initial').textContent = (user.name || user.email || 'M').charAt(0).toUpperCase();
    if (user.picture) {
      const image = $('user-avatar');
      image.addEventListener('load', () => { image.hidden = false; $('user-initial').hidden = true; });
      image.addEventListener('error', () => { image.hidden = true; $('user-initial').hidden = false; });
      image.src = user.picture;
    }
    if (user.authEnabled === false) {
      $('auth-warning').hidden = false;
      $('logout-btn').hidden = true;
    }
  } catch (error) {
    if (error.status === 401 || error.status === 403) blockSession(error);
  }
}

async function loadTypes() {
  try {
    const types = await request('/moderate-types');
    if (!Array.isArray(types)) return;
    for (const { name } of types) $('type').add(new Option(name.charAt(0).toUpperCase() + name.slice(1), name));
  } catch (_) { /* A pending submission can supply its own category. */ }
}

function schedulePoll(delay = pollDelay) {
  clearTimeout(pollTimer);
  if (!paused && !authBlocked && !currentJoke && !document.hidden) pollTimer = setTimeout(pollForJoke, delay);
}

async function pollForJoke() {
  if (fetching || processing || paused || currentJoke || authBlocked || document.hidden) return;
  fetching = true;
  try {
    const joke = await request('/moderate');
    pollDelay = 1500;
    if (joke) {
      currentJoke = joke;
      $('setup').value = joke.setup;
      $('punchline').value = joke.punchline;
      if (![...$('type').options].some(option => option.value === joke.type)) $('type').add(new Option(joke.type, joke.type));
      $('type').value = joke.type;
      $('mod-card').hidden = false;
      $('status-banner').hidden = true;
      connection('Ready to review');
    } else {
      status('All caught up. Nicely done.', 'The queue is clear. New submissions will appear here automatically.');
      connection('Connected');
    }
  } catch (error) {
    if (error.status === 401 || error.status === 403) blockSession(error);
    else {
      pollDelay = error.status === 429 ? error.retryAfter * 1000 : Math.min(pollDelay * 2, 12000);
      connection('Reconnecting', false);
      status('Taking a brief intermission.', `We couldn’t reach the queue. Trying again in ${Math.ceil(pollDelay / 1000)} seconds.`);
    }
  } finally {
    fetching = false;
    if (paused && !currentJoke) status('A well-earned pause.', 'Resume reviews whenever you’re ready.');
    schedulePoll();
  }
}

function setProcessing(value) {
  processing = value;
  $('btn-approve').disabled = value;
  $('btn-reject').disabled = value;
  $('pause-btn').disabled = value;
  $('mod-card').setAttribute('aria-busy', String(value));
  for (const id of ['setup', 'punchline', 'type']) $(id).disabled = value;
}

async function review(action) {
  if (!currentJoke || processing || authBlocked) return;
  const form = $('mod-card');
  const payload = { setup: $('setup').value.trim(), punchline: $('punchline').value.trim(), type: $('type').value.trim() };
  if (action === 'approved') {
    const errors = [];
    for (const [field, label] of [['setup', 'Add a setup before approving.'], ['punchline', 'Add a punchline before approving.'], ['type', 'Choose a category before approving.']]) {
      if (!payload[field]) errors.push({ field, message: label });
      else if (payload[field].length > (field === 'type' ? 50 : 500)) errors.push({ field, message: `Keep this to ${field === 'type' ? 50 : 500} characters or fewer.` });
    }
    if (errors.length) { showErrors(form, errors); return; }
  }
  clearErrors(form);
  $('review-error').hidden = true;
  setProcessing(true);
  $('btn-approve').querySelector('span').textContent = action === 'approved' ? 'Approving…' : 'Approve & publish';
  try {
    await request(action === 'approved' ? '/moderated' : '/reject', {
      method: 'POST',
      ...(action === 'approved' ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) } : {})
    });
    stats[action]++;
    $('stat-approved').textContent = stats.approved;
    $('stat-rejected').textContent = stats.rejected;
    $('stat-total').textContent = stats.approved + stats.rejected;
    toast(action === 'approved' ? 'Approved. Your joke is on its way to the collection.' : 'Joke rejected. On to the next one.');
    currentJoke = null;
    form.hidden = true;
    form.reset();
    $('status-banner').hidden = false;
    status('Finding the next good one.', 'Checking for another submission…');
    $('review-title').setAttribute('tabindex', '-1');
    $('review-title').focus({ preventScroll: true });
  } catch (error) {
    if (error.status === 401 || error.status === 403) blockSession(error);
    else {
      $('review-error').textContent = error.status === 429
        ? `Please wait ${error.retryAfter} seconds before trying again. Your edits are saved on this page.`
        : 'This review hasn’t been saved. Your edits are still here. Check your connection and try again.';
      $('review-error').hidden = false;
    }
  } finally {
    setProcessing(false);
    $('btn-approve').querySelector('span').textContent = 'Approve & publish';
    if (!currentJoke) schedulePoll(500);
  }
}

function openRejectDialog() {
  if (!currentJoke || processing || authBlocked || $('reject-dialog').open) return;
  $('reject-dialog').showModal();
}

document.addEventListener('DOMContentLoaded', async () => {
  $('mod-card').addEventListener('submit', event => { event.preventDefault(); review('approved'); });
  $('btn-reject').addEventListener('click', openRejectDialog);
  $('cancel-reject').addEventListener('click', () => $('reject-dialog').close());
  $('confirm-reject').addEventListener('click', () => { $('reject-dialog').close(); review('rejected'); });
  $('logout-btn').addEventListener('click', () => { location.href = `${gateway}/logout`; });
  $('pause-btn').addEventListener('click', () => {
    paused = !paused;
    $('pause-btn').setAttribute('aria-pressed', String(paused));
    $('pause-btn').innerHTML = `${icon(paused ? 'play' : 'pause')} ${paused ? 'Resume reviews' : 'Pause reviews'}`;
    clearTimeout(pollTimer);
    if (!currentJoke && !authBlocked) {
      connection(paused ? 'Paused' : 'Connected');
      status(paused ? 'A well-earned pause.' : 'Finding the next good one.', paused ? 'Resume reviews whenever you’re ready.' : 'Checking for another submission…');
    }
    if (!paused) schedulePoll(0);
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) clearTimeout(pollTimer);
    else schedulePoll(0);
  });
  document.addEventListener('keydown', event => {
    if (!currentJoke || processing || $('reject-dialog').open || event.repeat || event.isComposing) return;
    const editing = event.target.closest('input, textarea, select, [contenteditable="true"]');
    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
      event.preventDefault(); review('approved');
    } else if (!editing && !event.ctrlKey && !event.metaKey && !event.altKey) {
      if (event.key.toLowerCase() === 'a') { event.preventDefault(); review('approved'); }
      if (event.key.toLowerCase() === 'r') { event.preventDefault(); openRejectDialog(); }
    }
  });
  await Promise.allSettled([loadProfile(), loadTypes()]);
  schedulePoll(0);
});
