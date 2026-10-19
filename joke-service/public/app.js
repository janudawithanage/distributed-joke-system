'use strict';

const { request, icon, toast } = window.JokeUI;
const state = { type: 'any', busy: false, served: 0, sequence: 0, cooldown: 0, cooldownTimer: null };
const $ = id => document.getElementById(id);
const categoryLabel = name => name.replace(/(^|[-\s])\w/g, letter => letter.toUpperCase()).replace(/-/g, ' ');

function setButtonLabel(button, label) {
  button.querySelector('span').textContent = label;
}

function setCategory(type) {
  state.type = type;
  $('typeSelect').value = type;
  document.querySelectorAll('[data-type]').forEach(button => {
    button.setAttribute('aria-pressed', String(button.dataset.type === type));
  });
}

async function loadTypes() {
  try {
    const types = await request('/types');
    if (!Array.isArray(types)) throw new Error('The category list is unavailable.');
    $('metric-types').textContent = types.length;
    const chips = $('category-chips');
    const select = $('typeSelect');
    chips.replaceChildren();
    select.replaceChildren();
    [{ name: 'any' }, ...types].forEach(({ name }) => {
      const option = new Option(name === 'any' ? 'All jokes' : categoryLabel(name), name);
      select.add(option);
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'chip';
      chip.dataset.type = name;
      chip.textContent = name === 'any' ? 'All jokes' : categoryLabel(name);
      chip.setAttribute('aria-pressed', String(name === state.type));
      chip.addEventListener('click', () => {
        if (state.busy || Date.now() < state.cooldown || name === state.type) return;
        setCategory(name);
        getJokes();
      });
      chips.append(chip);
    });
    if (![...select.options].some(option => option.value === state.type)) setCategory('any');
    else select.value = state.type;
  } catch (_) {
    $('metric-types').textContent = '—';
    const retry = document.createElement('button');
    retry.type = 'button';
    retry.className = 'chip';
    retry.textContent = 'Retry categories';
    retry.addEventListener('click', async () => { retry.disabled = true; await loadTypes(); });
    $('category-chips').querySelector('[data-retry]')?.remove();
    retry.dataset.retry = 'true';
    $('category-chips').append(retry);
  }
}

function createJokeCard(joke, index) {
  const article = document.createElement('article');
  article.className = 'joke-card';
  const id = ++state.sequence;
  article.innerHTML = `
    <div class="joke-card-top"><span class="type-badge"></span><span class="joke-number"></span></div>
    <h3 class="setup"></h3>
    <p class="punchline" id="punchline-${id}" hidden></p>
    <div class="joke-card-bottom">
      <button class="reveal-btn" type="button" aria-expanded="false" aria-controls="punchline-${id}"><span>Reveal punchline</span>${icon('arrow')}</button>
      <button class="icon-btn copy-btn" type="button" aria-label="Copy joke to clipboard">${icon('copy')}</button>
    </div>`;
  article.querySelector('.type-badge').textContent = categoryLabel(joke.type || 'general');
  article.querySelector('.joke-number').textContent = String(index + 1).padStart(2, '0');
  article.querySelector('.setup').textContent = joke.setup;
  const punchline = article.querySelector('.punchline');
  punchline.textContent = joke.punchline;
  const reveal = article.querySelector('.reveal-btn');
  reveal.addEventListener('click', () => {
    const expanded = reveal.getAttribute('aria-expanded') !== 'true';
    reveal.setAttribute('aria-expanded', String(expanded));
    reveal.querySelector('span').textContent = expanded ? 'Hide punchline' : 'Reveal punchline';
    punchline.hidden = !expanded;
  });
  article.querySelector('.copy-btn').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(`${joke.setup}\n\n${joke.punchline}`);
      toast('Joke copied. Pass the good mood on.');
    } catch (_) {
      toast('Copy is unavailable. You can select the joke text to share it.');
    }
  });
  return article;
}

function showBrowseError(message, rateLimited = false) {
  let notice = $('browse-error');
  if (!notice) {
    notice = document.createElement('div');
    notice.id = 'browse-error';
    notice.className = 'notice notice-error';
    notice.setAttribute('role', 'alert');
    $('jokesContainer').before(notice);
  }
  notice.textContent = message;
  notice.hidden = false;
  if (!$('jokesContainer').querySelector('.joke-card:not(.skeleton)')) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    const title = document.createElement('h3');
    title.textContent = rateLimited ? 'A little pause for the punchline.' : 'The laughs are taking a moment.';
    const description = document.createElement('p');
    description.textContent = rateLimited
      ? 'You can still reveal and share the opening act above. Fresh jokes will be ready shortly.'
      : 'Check your connection, then shuffle again. We’ll be right here.';
    empty.append(title, description);
    $('jokesContainer').replaceChildren(empty);
  }
}

function startCooldown(seconds) {
  clearInterval(state.cooldownTimer);
  state.cooldown = Date.now() + seconds * 1000;
  const update = () => {
    const remaining = Math.max(0, Math.ceil((state.cooldown - Date.now()) / 1000));
    $('getJokeBtn').disabled = remaining > 0 || state.busy;
    document.querySelectorAll('[data-type]').forEach(button => { button.disabled = remaining > 0 || state.busy; });
    setButtonLabel($('getJokeBtn'), remaining > 0 ? `Try in ${remaining}s` : 'Shuffle jokes');
    if (!remaining) clearInterval(state.cooldownTimer);
  };
  update();
  state.cooldownTimer = setInterval(update, 1000);
}

async function getJokes() {
  if (state.busy || Date.now() < state.cooldown) return;
  const input = $('countInput');
  if (!input.reportValidity()) return;
  const count = Math.min(20, Math.max(1, Number(input.value) || 3));
  input.value = count;
  state.busy = true;
  document.querySelectorAll('[data-type]').forEach(button => { button.disabled = true; });
  $('getJokeBtn').disabled = true;
  setButtonLabel($('getJokeBtn'), 'Finding laughs…');
  $('jokesContainer').setAttribute('aria-busy', 'true');
  $('browse-error')?.setAttribute('hidden', '');
  $('browse-status').textContent = 'Finding your next laughs.';
  try {
    const data = await request(`/joke/${encodeURIComponent(state.type)}?count=${count}`);
    const jokes = (Array.isArray(data) ? data : [data]).filter(joke => joke && typeof joke.setup === 'string' && typeof joke.punchline === 'string');
    if (!jokes.length) {
      const empty = document.createElement('div');
      empty.className = 'empty-state';
      empty.innerHTML = '<h3>The first laugh could be yours.</h3><p>No jokes in this category yet. Try another category or share the first one.</p>';
      $('jokesContainer').replaceChildren(empty);
      $('browse-status').textContent = 'No jokes in this category yet.';
      return;
    }
    $('jokesContainer').replaceChildren(...jokes.map(createJokeCard));
    state.served += jokes.length;
    $('metric-jokes').textContent = state.served;
    $('browse-status').textContent = `Showing ${jokes.length} ${state.type === 'any' ? '' : categoryLabel(state.type) + ' '}joke${jokes.length === 1 ? '' : 's'}. Reveal a punchline when you're ready.`;
    const featured = jokes[0];
    $('featured-setup').textContent = featured.setup;
    $('featured-punchline').textContent = featured.punchline;
    $('featured-punchline').hidden = true;
    $('featured-type').textContent = `A little ${featured.type || 'general'} humor`;
    $('feature-reveal').setAttribute('aria-expanded', 'false');
    $('feature-reveal').innerHTML = `Reveal the punchline ${icon('arrow')}`;
  } catch (error) {
    if (error.status === 429) {
      showBrowseError(`You've found plenty of laughs. Try another shuffle in ${error.retryAfter} seconds.`, true);
      startCooldown(error.retryAfter);
    } else {
      showBrowseError(error.status === 404 ? 'No jokes here yet. Try another category or share the first one.' : 'We couldn’t reach the collection. Check your connection and try shuffling again.');
    }
    $('browse-status').textContent = 'Jokes could not be refreshed.';
  } finally {
    state.busy = false;
    $('jokesContainer').setAttribute('aria-busy', 'false');
    if (Date.now() >= state.cooldown) {
      document.querySelectorAll('[data-type]').forEach(button => { button.disabled = false; });
      $('getJokeBtn').disabled = false;
      setButtonLabel($('getJokeBtn'), 'Shuffle jokes');
    }
  }
}

async function loadHealth() {
  const indicator = $('health-indicator');
  try {
    const health = await request('/health');
    if (health?.status !== 'ok') throw new Error('Unavailable');
    indicator.innerHTML = '<span class="status-dot"></span>All good behind the scenes';
    indicator.style.color = 'var(--green)';
  } catch (_) {
    indicator.innerHTML = '<span class="status-dot"></span>Connection interrupted. Try refreshing.';
    indicator.style.color = 'var(--danger)';
  }
}

document.addEventListener('DOMContentLoaded', () => {
  $('browse-form').addEventListener('submit', event => { event.preventDefault(); getJokes(); });
  $('feature-reveal').addEventListener('click', () => {
    const expanded = $('feature-reveal').getAttribute('aria-expanded') !== 'true';
    $('feature-reveal').setAttribute('aria-expanded', String(expanded));
    $('featured-punchline').hidden = !expanded;
    $('feature-reveal').innerHTML = `${expanded ? 'Hide the punchline' : 'Reveal the punchline'} ${icon('arrow')}`;
  });
  loadTypes();
  loadHealth();
  getJokes();
});
