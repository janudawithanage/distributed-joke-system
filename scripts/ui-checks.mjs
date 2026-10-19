// Runs inside the Playwright MCP server, with its browser page supplied by MCP.
export async function reviewUI(page, config) {
  const checks = [];
  const jsErrors = [];
  const assetErrors = [];
  page.on('pageerror', error => jsErrors.push(error.message));
  page.on('response', response => {
    if (/\.(css|js|woff2|svg)(\?|$)/.test(response.url()) && response.status() >= 400) assetErrors.push(`${response.status()} ${response.url()}`);
  });
  const check = (name, pass, detail = '') => checks.push({ name, pass: Boolean(pass), ...(detail ? { detail } : {}) });
  const shot = async name => {
    // Let Chrome finish repainting after viewport changes before capture.
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    return page.screenshot({ path: `${config.output}/${name}.png`, fullPage: true, animations: 'disabled' });
  };
  const visit = async route => {
    await page.goto(`${config.base}/${route}/`);
    await page.waitForFunction(() => window.JokeUI && document.fonts.status === 'loaded');
  };
  const waitBrowse = () => page.waitForFunction(() => document.getElementById('jokesContainer').getAttribute('aria-busy') === 'false');
  const overflow = () => page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
  const audit = async label => {
    await page.addScriptTag({ path: config.axePath });
    const violations = await page.evaluate(async () => {
      const result = await window.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'] } });
      return result.violations.map(item => ({ id: item.id, nodes: item.nodes.map(node => node.target.join(' ')) }));
    });
    check(`${label}: automated accessibility`, violations.length === 0, violations.length ? JSON.stringify(violations) : 'No WCAG A/AA violations detected');
  };

  // Real services and real content first; no API interception in this section.
  for (const route of ['joke-ui', 'submit', 'moderate-ui']) {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await visit(route);
    if (route === 'joke-ui') await waitBrowse();
    if (route === 'moderate-ui') await page.waitForFunction(() => document.querySelector('#queue-connection').textContent !== 'Connecting…');
    for (const [width, height] of [[1440,1000], [1024,768], [768,1024], [600,960], [430,932], [390,844], [375,812], [360,800], [320,740], [844,390]]) {
      await page.setViewportSize({ width, height });
      const targets = await page.evaluate(() => [...document.querySelectorAll('button,a,input,select,textarea,summary')]
        .filter(el => el.getClientRects().length && !el.classList.contains('skip-link'))
        .filter(el => { const rect = el.getBoundingClientRect(); return rect.width < 43 || rect.height < 43; })
        .map(el => el.getAttribute('aria-label') || el.textContent.trim()));
      check(`${route} ${width}×${height}: no overflow and usable targets`, !(await overflow()) && targets.length === 0, targets.join(', '));
      if ([1440, 768, 390, 320, 844].includes(width)) await shot(`${route}-${width}`);
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await audit(`${route} mobile`);
    await page.setViewportSize({ width: 1440, height: 1000 });
    await audit(`${route} desktop`);
    await page.setViewportSize({ width: 320, height: 740 });
    await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: 'dark' });
    await page.evaluate(() => document.documentElement.style.fontSize = '200%');
    check(`${route}: 200% text at 320px`, !(await overflow()));
    check(`${route}: reduced motion`, await page.evaluate(() => getComputedStyle(document.documentElement).scrollBehavior === 'auto'));
    await shot(`${route}-text-200`);
    await page.evaluate(() => document.documentElement.style.fontSize = '');
    await page.emulateMedia({ reducedMotion: 'no-preference', colorScheme: 'light' });
  }

  // A real submission goes through RabbitMQ and is rejected only if it is ours.
  const queueResponse = await page.request.get(`${config.base}/moderate`);
  if (queueResponse.status() === 204) {
    const marker = `UI review ${Date.now()}: Why did the developer bring a ladder?`;
    await page.setViewportSize({ width: 390, height: 844 });
    await visit('submit');
    await page.waitForFunction(() => document.querySelector('#typeSelect option[value="__custom__"]'));
    await page.locator('#setup').fill(marker);
    await page.locator('#punchline').fill('To reach the next level.');
    await page.locator('#typeSelect').selectOption('__custom__');
    await page.locator('#typeCustom').fill('general');
    await page.locator('#submitBtn').click();
    await page.locator('#submission-success').waitFor({ state: 'visible' });
    check('Live pipeline: mobile submission accepted by service', true);
    await visit('moderate-ui');
    await page.locator('#mod-card').waitFor({ state: 'visible' });
    const receivedOwnJoke = await page.locator('#setup').inputValue() === marker;
    check('Live pipeline: submission arrives for review', receivedOwnJoke);
    if (receivedOwnJoke) {
      await page.locator('#btn-reject').click();
      await page.locator('#confirm-reject').click();
      await page.waitForFunction(() => document.getElementById('stat-rejected').textContent === '1');
      check('Live pipeline: test submission removed through review UI', true);
    }
  }

  // Deterministic API fixtures exercise failure states without altering user data.
  const types = [{ name: 'general' }, { name: 'programming' }];
  const jokes = [
    { setup: 'Why do programmers prefer dark mode?', punchline: 'Because light attracts bugs.', type: 'programming' },
    { setup: 'What did one wall say to the other?', punchline: 'Meet you at the corner.', type: 'general' },
    { setup: 'Why did the function return early?', punchline: 'It had a date with a callback.', type: 'programming' }
  ];
  const respond = (route, status, body, headers = {}) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body), headers });
  let browseMode = 'ok';
  let browseRequests = 0;
  await page.route('**/types', route => respond(route, 200, types));
  await page.route('**/joke/*', async route => {
    browseRequests++;
    if (browseMode === 'offline') return route.abort();
    if (browseMode === 'limited') return respond(route, 429, { message: 'Too many requests' }, { 'Retry-After': '2' });
    if (browseMode === 'empty') return respond(route, 200, []);
    const type = new URL(route.request().url()).pathname.split('/').pop();
    return respond(route, 200, type === 'any' ? jokes : jokes.filter(joke => joke.type === type));
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await visit('joke-ui');
  await waitBrowse();
  check('Browse: initial jokes load', await page.locator('.joke-card:not(.skeleton)').count() === 3);
  const card = page.locator('.joke-card').first();
  await card.locator('.reveal-btn').click();
  check('Browse: reveal punchline', await card.locator('.punchline').isVisible());
  await card.locator('.reveal-btn').click();
  check('Browse: hide punchline', await card.locator('.punchline').isHidden());
  await page.locator('#feature-reveal').click();
  check('Browse: featured joke reveal', await page.locator('#featured-punchline').isVisible());
  await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async text => { window.copiedJoke = text; } } }));
  await card.locator('.copy-btn').click();
  check('Browse: copy shares both parts', await page.evaluate(() => window.copiedJoke.includes('Because light attracts bugs.')));
  await page.locator('[data-type="programming"]').click();
  await waitBrowse();
  check('Browse: category filtering', await page.locator('.joke-card').count() === 2 && await page.locator('[data-type="programming"]').getAttribute('aria-pressed') === 'true');
  browseMode = 'offline';
  await page.locator('#getJokeBtn').click();
  await waitBrowse();
  check('Browse: network failure preserves jokes', await page.locator('#browse-error').isVisible() && await page.locator('.joke-card').count() === 2);
  browseMode = 'limited';
  await page.locator('#getJokeBtn').click();
  await waitBrowse();
  check('Browse: rate limit countdown', await page.locator('#getJokeBtn').isDisabled());
  await page.waitForFunction(() => !document.getElementById('getJokeBtn').disabled);
  check('Browse: rate limit recovers automatically', await page.locator('#getJokeBtn').isEnabled());
  browseMode = 'empty';
  await page.locator('#getJokeBtn').click();
  await waitBrowse();
  check('Browse: empty category state', await page.locator('.empty-state').isVisible());
  browseMode = 'ok';
  const originalSetup = jokes[0].setup;
  jokes[0].setup = 'W'.repeat(500);
  await visit('joke-ui');
  await waitBrowse();
  await page.setViewportSize({ width: 320, height: 740 });
  check('Browse: long unbroken setup fits narrow cards', !(await overflow()));
  jokes[0].setup = originalSetup;
  await page.keyboard.press('Tab');
  check('Keyboard: skip link is first', await page.locator('.skip-link').evaluate(el => el === document.activeElement));
  await page.keyboard.press('Enter');
  check('Keyboard: skip link focuses content', await page.locator('#main').evaluate(el => el === document.activeElement));
  await page.locator('.mobile-nav a[data-route="/submit/"]').click();
  await page.waitForURL('**/submit/');
  check('Mobile: bottom navigation works', await page.locator('#submit-form').isVisible());

  let submitMode = 'error';
  let submitted = null;
  await page.route('**/submit', async route => {
    if (route.request().method() !== 'POST') return route.continue();
    submitted = route.request().postDataJSON();
    return submitMode === 'error' ? respond(route, 503, { error: 'Unavailable' }) : respond(route, 202, { message: 'Queued' });
  });
  await page.locator('#submitBtn').click();
  check('Submit: linked validation summary gets focus', await page.locator('#form-errors').evaluate(el => el === document.activeElement) && await page.locator('[aria-invalid="true"]').count() === 3);
  await page.locator('#form-errors a').first().click();
  check('Submit: error link focuses field', await page.locator('#setup').evaluate(el => el === document.activeElement));
  await page.locator('#setup').fill('Why did the developer go broke?');
  await page.locator('#punchline').fill('Because they used up all their cache.');
  await page.locator('#typeSelect').selectOption('__custom__');
  await page.locator('#typeCustom').fill('wordplay');
  check('Submit: live preview', await page.locator('#preview-setup').textContent() === 'Why did the developer go broke?' && await page.locator('#preview-type').textContent() === 'wordplay');
  await page.reload();
  await page.waitForFunction(() => document.getElementById('setup').value === 'Why did the developer go broke?');
  check('Submit: draft survives refresh', await page.locator('#punchline').inputValue() === 'Because they used up all their cache.' && await page.locator('#typeCustom').inputValue() === 'wordplay');
  await page.locator('#submitBtn').click();
  await page.locator('#alertBox').waitFor({ state: 'visible' });
  check('Submit: failed request keeps draft', await page.locator('#setup').inputValue() === 'Why did the developer go broke?');
  submitMode = 'ok';
  await page.locator('#submitBtn').click();
  await page.locator('#submission-success').waitFor({ state: 'visible' });
  check('Submit: custom category reaches API', submitted.type === 'wordplay' && submitted.punchline === 'Because they used up all their cache.');
  check('Submit: success clears saved draft', await page.evaluate(() => localStorage.getItem('jokeplatform:submission-draft:v1') === null));
  await shot('submit-success-mobile');
  await page.locator('#submit-another').click();
  check('Submit: another joke starts fresh', await page.locator('#setup').inputValue() === '' && await page.locator('#setup').evaluate(el => el === document.activeElement));

  let pending = { ...jokes[0] };
  let actionMode = 'error';
  let authMode = 'ok';
  let pollCount = 0;
  let approvedPayload;
  await page.route('**/me', route => authMode === 'unauthorized'
    ? respond(route, 401, { error: 'Sign in' })
    : respond(route, 200, { name: 'Test Moderator', authEnabled: true }));
  await page.route('**/moderate-types', route => respond(route, 200, types));
  await page.route('**/moderate', route => {
    pollCount++;
    if (authMode === 'forbidden') return respond(route, 403, { error: 'Forbidden' });
    return pending ? respond(route, 200, pending) : route.fulfill({ status: 204 });
  });
  await page.route('**/moderated', route => {
    approvedPayload = route.request().postDataJSON();
    if (actionMode === 'error') return respond(route, 503, { error: 'Unavailable' });
    pending = null;
    return respond(route, 202, { message: 'Approved' });
  });
  await page.route('**/reject', route => {
    pending = null;
    return respond(route, 200, { message: 'Rejected' });
  });
  await visit('moderate-ui');
  await page.locator('#mod-card').waitFor({ state: 'visible' });
  await page.locator('#setup').fill('An edited setup');
  await page.locator('#btn-approve').click();
  await page.locator('#review-error').waitFor({ state: 'visible' });
  check('Moderate: failed approval retains edits', await page.locator('#setup').inputValue() === 'An edited setup' && await page.locator('#mod-card').isVisible());
  await page.locator('#setup').fill('');
  await page.locator('#btn-approve').click();
  check('Moderate: validation prevents empty approval', await page.locator('#setup').getAttribute('aria-invalid') === 'true');
  await page.locator('#setup').fill('An edited setup');
  actionMode = 'ok';
  await page.keyboard.press('Control+Enter');
  await page.waitForFunction(() => document.getElementById('stat-approved').textContent === '1');
  check('Moderate: keyboard approval sends edits and updates stats', approvedPayload.setup === 'An edited setup' && await page.locator('#stat-total').textContent() === '1');
  await page.locator('#pause-btn').click();
  const pollsAtPause = pollCount;
  await page.waitForTimeout(1800);
  check('Moderate: pause stops queue requests', pollCount === pollsAtPause && await page.locator('#pause-btn').getAttribute('aria-pressed') === 'true');
  pending = { ...jokes[1] };
  await page.locator('#pause-btn').click();
  await page.locator('#mod-card').waitFor({ state: 'visible' });
  check('Moderate: resume gets next submission', await page.locator('#setup').inputValue() === jokes[1].setup);
  await page.locator('#btn-reject').click();
  check('Moderate: reject needs confirmation', await page.locator('#reject-dialog').isVisible() && pending !== null);
  await page.keyboard.press('Escape');
  check('Moderate: Escape cancels rejection', await page.locator('#reject-dialog').isHidden() && pending !== null);
  await page.locator('#btn-reject').click();
  await page.locator('#confirm-reject').click();
  await page.waitForFunction(() => document.getElementById('stat-rejected').textContent === '1');
  check('Moderate: confirmed rejection updates session counts', await page.locator('#stat-total').textContent() === '2');
  await page.locator('#pause-btn').click();
  authMode = 'unauthorized';
  await visit('moderate-ui');
  await page.locator('#login-link').waitFor({ state: 'visible' });
  check('Moderate: signed-out state offers login', await page.locator('#login-link').getAttribute('href') === `${config.base}/login`);
  authMode = 'forbidden';
  await visit('moderate-ui');
  await page.waitForFunction(() => document.getElementById('status-title').textContent === 'A moderator account is needed.');
  check('Moderate: permission failure stops polling', await page.locator('#status-title').textContent() === 'A moderator account is needed.');

  // Verify extreme content and focus are contained in the mobile review layout.
  authMode = 'ok';
  pending = { setup: 'W'.repeat(500), punchline: 'L'.repeat(500), type: 'category'.repeat(6) };
  await visit('moderate-ui');
  await page.locator('#mod-card').waitFor({ state: 'visible' });
  await page.setViewportSize({ width: 320, height: 740 });
  check('Moderate: long content at 320px', !(await overflow()));
  await shot('moderate-review-mobile');
  await audit('Moderate review mobile');
  await page.locator('#btn-reject').click();
  await shot('moderate-reject-dialog');
  await audit('Reject dialog mobile');
  await page.keyboard.press('Escape');
  check('All pages: no uncaught JavaScript errors', jsErrors.length === 0, jsErrors.join('; '));
  check('All pages: assets load successfully', assetErrors.length === 0, assetErrors.join('; '));
  return { checks, fixtureBrowseRequests: browseRequests, testedAt: new Date().toISOString() };
}
