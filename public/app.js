/* Prayer Wall – single-page app (vanilla JS, hash routing) */
(() => {
  const $app = document.getElementById('app');
  const state = {
    user: null,
    avatars: ['🙂', '😊', '🕊️', '🌻', '🌿', '⭐', '🔥', '🦁', '🐑', '🌈', '☀️', '💧', '🍇', '🌾', '⛰️', '🎵'],
    categories: ['General', 'Health', 'Family', 'Work', 'Studies', 'Finances', 'Spiritual', 'Thanksgiving'],
    filter: 'all',
    stats: null,
  };

  // Public-domain verses (World English Bible)
  const VERSES = [
    ['In nothing be anxious, but in everything, by prayer and petition with thanksgiving, let your requests be made known to God.', 'Philippians 4:6'],
    ['Pray for one another, that you may be healed. The insistent prayer of a righteous person is powerfully effective.', 'James 5:16'],
    ['For where two or three are gathered together in my name, there I am in the middle of them.', 'Matthew 18:20'],
    ['Always rejoice. Pray without ceasing. In everything give thanks, for this is the will of God in Christ Jesus toward you.', '1 Thessalonians 5:16–18'],
    ['Bear one another’s burdens, and so fulfill the law of Christ.', 'Galatians 6:2'],
    ['Call to me, and I will answer you, and will show you great and difficult things, which you don’t know.', 'Jeremiah 33:3'],
    ['Ask, and it will be given you. Seek, and you will find. Knock, and it will be opened for you.', 'Matthew 7:7'],
    ['Casting all your worries on him, because he cares for you.', '1 Peter 5:7'],
  ];

  // ---------- utilities ----------
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  async function api(path, opts = {}) {
    try {
      return await window.PrayerAPI.call(path, opts);
    } catch (err) {
      if (err.status === 401 && path !== '/login' && path !== '/register') {
        state.user = null;
        go('#/login');
      } else if (err.status === 403 && err.message === 'Please change your password first') {
        if (state.user) state.user.must_change_password = true;
        go('#/change-password');
      }
      throw err;
    }
  }

  function toast(msg, isErr) {
    const t = document.getElementById('toast');
    t.textContent = msg;
    t.className = 'toast show' + (isErr ? ' err' : '');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => (t.className = 'toast'), 2600);
  }

  function timeAgo(sqlDate) {
    const d = new Date(sqlDate);
    const s = Math.floor((Date.now() - d) / 1000);
    if (s < 60) return 'just now';
    if (s < 3600) return Math.floor(s / 60) + 'm ago';
    if (s < 86400) return Math.floor(s / 3600) + 'h ago';
    if (s < 86400 * 7) return Math.floor(s / 86400) + 'd ago';
    return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
  }

  function go(hash) {
    if (location.hash === hash) render();
    else location.hash = hash;
  }

  function confetti() {
    const colors = ['#58cc02', '#1cb0f6', '#ffc800', '#ff4b4b', '#ce82ff', '#ff9600'];
    for (let i = 0; i < 60; i++) {
      const c = document.createElement('div');
      c.className = 'confetti';
      c.style.left = Math.random() * 100 + 'vw';
      c.style.background = colors[i % colors.length];
      c.style.animationDuration = 1.6 + Math.random() * 1.6 + 's';
      c.style.animationDelay = Math.random() * 0.4 + 's';
      c.style.borderRadius = Math.random() > 0.5 ? '50%' : '2px';
      document.body.appendChild(c);
      setTimeout(() => c.remove(), 3800);
    }
  }

  // Modal helpers -----------------------------------------------------
  function modal(html, onMount) {
    const root = document.getElementById('modal-root');
    root.innerHTML = `<div class="overlay"><div class="modal">${html}</div></div>`;
    const overlay = root.firstElementChild;
    const close = () => (root.innerHTML = '');
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
    onMount && onMount(overlay, close);
    return close;
  }

  function confirmBox(title, text, okLabel = 'Yes', danger = true) {
    return new Promise((resolve) => {
      modal(
        `<h2>${esc(title)}</h2><p class="muted">${esc(text)}</p>
         <div class="actions">
           <button class="btn btn-ghost" data-no>Cancel</button>
           <button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-yes>${esc(okLabel)}</button>
         </div>`,
        (el, close) => {
          el.querySelector('[data-no]').onclick = () => { close(); resolve(false); };
          el.querySelector('[data-yes]').onclick = () => { close(); resolve(true); };
        }
      );
    });
  }

  function celebrate(emoji, title, text) {
    modal(
      `<div class="celebrate"><div class="big">${emoji}</div><h2>${esc(title)}</h2>
       <p class="muted">${esc(text)}</p>
       <div class="actions"><button class="btn btn-primary" data-ok>Continue</button></div></div>`,
      (el, close) => (el.querySelector('[data-ok]').onclick = close)
    );
  }

  // ---------- layout ----------
  const NAV = [
    { hash: '#/', ico: '🏠', label: 'Prayer Wall' },
    { hash: '#/new', ico: '➕', label: 'New Request' },
    { hash: '#/members', ico: '👥', label: 'Members' },
    { hash: '#/profile', ico: '👤', label: 'Profile' },
  ];

  function shell(inner, rail = '') {
    const cur = location.hash || '#/';
    const isActive = (h) => (h === '#/' ? cur === '#/' || cur === '' || cur.startsWith('#/request') : cur.startsWith(h));
    const s = state.stats;
    $app.innerHTML = `
      <div class="shell">
        <nav class="sidebar">
          <div class="brand"><span>🕊️</span> prayer wall</div>
          ${NAV.map((n) => `<a class="nav-link ${isActive(n.hash) ? 'active' : ''}" href="${n.hash}"><span class="ico">${n.ico}</span>${n.label}</a>`).join('')}
        </nav>
        <div class="main">
          <div class="content">
            <div class="topbar">
              ${s ? `
                <span class="stat-pill fire ${s.prayedToday ? '' : 'cold'}" title="Prayer streak (days in a row)">🔥 ${s.streak}</span>
                <span class="stat-pill pray" title="Prayers you have offered">🙏 ${s.myPrayers}</span>
                <span class="stat-pill gold" title="Answered prayers in the cell">⭐ ${s.answered}</span>` : ''}
              <span class="avatar" title="${esc(state.user.display_name)}">${esc(state.user.avatar)}</span>
            </div>
            ${inner}
          </div>
          ${rail ? `<aside class="rail">${rail}</aside>` : ''}
        </div>
        <nav class="bottom-nav">
          ${NAV.map((n) => `<a href="${n.hash}" class="${isActive(n.hash) ? 'active' : ''}" aria-label="${n.label}">${n.ico}</a>`).join('')}
        </nav>
      </div>`;
  }

  async function refreshStats() {
    try { state.stats = await api('/stats'); } catch { /* handled */ }
  }

  // ---------- views ----------
  async function viewLogin() {
    let needsLeader = false;
    try { needsLeader = (await api('/setup-status')).needsLeader; } catch { /* offline */ }
    if (needsLeader) return viewRegister(true);
    $app.innerHTML = `
      <div class="auth-wrap"><div class="auth-card">
        <div class="mascot">🕊️</div>
        <h1>prayer wall</h1>
        <p class="muted">Bear one another’s burdens together.</p>
        <form id="f">
          <div class="field"><input class="input" name="username" placeholder="Username" autocomplete="username" autocapitalize="none" required /></div>
          <div class="field"><input class="input" name="password" type="password" placeholder="Password" autocomplete="current-password" required /></div>
          <div class="error-msg" id="err"></div>
          <button class="btn btn-primary btn-block" type="submit">Log in</button>
        </form>
        <p style="margin-top:18px" class="muted">New here? <a href="#/register">Create an account</a></p>
        <div class="hint">If your system admin added you, your first password is <b>p@ssw0rd</b> — you’ll be asked to change it.</div>
      </div></div>`;
    const f = document.getElementById('f');
    f.username.focus();
    f.onsubmit = async (e) => {
      e.preventDefault();
      const btn = f.querySelector('button');
      btn.disabled = true;
      try {
        const { user } = await api('/login', { method: 'POST', body: { username: f.username.value, password: f.password.value } });
        state.user = user;
        await loadMe();
        go(user.must_change_password ? '#/change-password' : '#/');
      } catch (err) {
        document.getElementById('err').textContent = err.message;
        btn.disabled = false;
      }
    };
  }

  function viewRegister(asLeader) {
    $app.innerHTML = `
      <div class="auth-wrap"><div class="auth-card">
        <div class="mascot">${asLeader ? '👑' : '🕊️'}</div>
        <h1>${asLeader ? 'Set up your cell' : 'Join your cell'}</h1>
        <p class="muted">${asLeader
          ? 'No one has signed up yet. Create the first account — you’ll be the <b>System Admin</b> and can invite members, reset their passwords and remove members who have left the cell.'
          : 'Ask your system admin for the <b>cell invite code</b>, then create your account.'}</p>
        <form id="rg">
          ${asLeader ? '' : `<div class="field"><label>Cell invite code</label><input class="input" name="inviteCode" maxlength="20" placeholder="e.g. K7PQ2M" autocapitalize="characters" autocomplete="off" required style="text-transform:uppercase;letter-spacing:3px" /></div>`}
          <div class="field"><label>Your name</label><input class="input" name="display_name" maxlength="40" placeholder="e.g. Grace Tan" autocomplete="name" required /></div>
          <div class="field"><label>Username</label><input class="input" name="username" maxlength="30" placeholder="e.g. grace" autocapitalize="none" autocomplete="username" required /></div>
          <div class="field"><label>Password</label><input class="input" type="password" name="password" minlength="6" autocomplete="new-password" required /></div>
          <div class="field"><label>Confirm password</label><input class="input" type="password" name="confirm" minlength="6" autocomplete="new-password" required /></div>
          <div class="error-msg" id="err"></div>
          <button class="btn btn-primary btn-block" type="submit">${asLeader ? 'Create admin account' : 'Create account'}</button>
        </form>
        ${asLeader ? '' : '<p style="margin-top:18px" class="muted">Already have an account? <a href="#/login">Log in</a></p>'}
      </div></div>`;
    const f = document.getElementById('rg');
    (f.inviteCode || f.display_name).focus();
    f.display_name.oninput = () => {
      if (f.username.dataset.touched) return;
      f.username.value = f.display_name.value.trim().toLowerCase().split(/\s+/)[0]?.replace(/[^a-z0-9._-]/g, '') || '';
    };
    f.username.oninput = () => (f.username.dataset.touched = '1');
    f.onsubmit = async (e) => {
      e.preventDefault();
      const err = document.getElementById('err');
      if (f.password.value !== f.confirm.value) return (err.textContent = 'Passwords do not match');
      const btn = f.querySelector('button[type=submit]');
      btn.disabled = true;
      try {
        const { user, isLeader } = await api('/register', { method: 'POST', body: {
          inviteCode: f.inviteCode?.value, display_name: f.display_name.value, username: f.username.value, password: f.password.value,
        } });
        state.user = user;
        await loadMe();
        go(isLeader ? '#/members' : '#/');
        setTimeout(() => isLeader
          ? celebrate('👑', 'Welcome, System Admin!', 'Share the invite code below so cell members can sign up. From this page you can also reset passwords and remove members who have left.')
          : celebrate('🎉', `Welcome, ${user.display_name}!`, 'You’ve joined the prayer wall. Share a request or pray for someone today.'), 300);
      } catch (e2) { err.textContent = e2.message; btn.disabled = false; }
    };
  }

  function passwordForm(forced) {
    return `
      <form id="pw">
        <div class="field"><label>Current password</label><input class="input" type="password" name="currentPassword" autocomplete="current-password" required ${forced ? 'value="p@ssw0rd"' : ''} /></div>
        <div class="field"><label>New password</label><input class="input" type="password" name="newPassword" autocomplete="new-password" minlength="6" required /></div>
        <div class="field"><label>Confirm new password</label><input class="input" type="password" name="confirm" autocomplete="new-password" minlength="6" required /></div>
        <div class="error-msg" id="pwerr"></div>
        <button class="btn btn-primary btn-block" type="submit">Save password</button>
      </form>`;
  }

  function bindPasswordForm(after) {
    const f = document.getElementById('pw');
    f.onsubmit = async (e) => {
      e.preventDefault();
      const err = document.getElementById('pwerr');
      if (f.newPassword.value !== f.confirm.value) return (err.textContent = 'New passwords do not match');
      try {
        const { user } = await api('/me/password', { method: 'POST', body: { currentPassword: f.currentPassword.value, newPassword: f.newPassword.value } });
        state.user = user;
        after();
      } catch (e2) { err.textContent = e2.message; }
    };
  }

  function viewChangePassword() {
    $app.innerHTML = `
      <div class="auth-wrap"><div class="auth-card">
        <div class="mascot">🔐</div>
        <h1>Welcome, ${esc(state.user.display_name)}!</h1>
        <p class="muted">Before you start, please set your own password.</p>
        ${passwordForm(true)}
        <p style="margin-top:14px"><a href="#" id="lo">Log out</a></p>
      </div></div>`;
    document.getElementById('lo').onclick = (e) => { e.preventDefault(); logout(); };
    document.querySelector('#pw [name=newPassword]').focus();
    bindPasswordForm(async () => {
      await refreshStats();
      go('#/');
      celebrate('🎉', 'You’re all set!', 'Your password has been changed. Welcome to the prayer wall.');
    });
  }

  function requestCard(r) {
    const tags = [
      r.status === 'answered' ? '<span class="tag answered">⭐ Answered</span>' : '<span class="tag active">Praying</span>',
      `<span class="tag cat">${esc(r.category)}</span>`,
      r.is_mine ? '<span class="tag mine">Mine</span>' : '',
      r.prayed_by_me && !r.is_mine ? '<span class="tag prayed">🙏 You prayed</span>' : '',
    ].join(' ');
    return `
      <a class="req-card ${r.status === 'answered' ? 'answered' : ''}" href="#/request/${r.id}">
        <div class="head">
          <span class="avatar">${esc(r.author_avatar)}</span>
          <div class="who"><div class="n">${esc(r.is_mine ? 'You' : r.author_name)}</div><div class="muted small">${timeAgo(r.created_at)}</div></div>
        </div>
        <div class="title">${esc(r.title)}</div>
        <div class="body">${esc(r.body)}</div>
        <div class="foot">${tags}<span style="flex:1"></span><span class="count">🙏 ${r.prayer_count}</span></div>
      </a>`;
  }

  function railHtml() {
    const s = state.stats;
    if (!s) return '';
    const pct = Math.min(100, Math.round((s.prayedThisWeek / s.weeklyGoal) * 100));
    const rank = (i) => `<span class="rank r${i + 1}">${i + 1}</span>`;
    return `
      <div class="card goal-card">
        <h3>Weekly goal</h3>
        <p class="muted small">Pray for others ${s.weeklyGoal} times this week</p>
        <div class="bar"><span style="width:${pct}%"></span></div>
        <div class="muted small">${s.prayedThisWeek} / ${s.weeklyGoal} prayers ${pct >= 100 ? '— goal reached! 🏆' : ''}</div>
      </div>
      <div class="card">
        <h3>This week’s intercessors</h3>
        <p class="muted small">Prayers offered in the last 7 days</p>
        ${s.leaderboard.map((l, i) => `
          <div class="leader-row ${l.id === state.user.id ? 'me' : ''}">
            ${rank(i)}<span class="avatar">${esc(l.avatar)}</span>
            <span class="name">${esc(l.display_name)}</span><span class="xp">${l.n} 🙏</span>
          </div>`).join('')}
      </div>`;
  }

  async function viewDashboard() {
    const [{ requests }] = await Promise.all([api('/requests?filter=' + state.filter), refreshStats()]);
    const s = state.stats;
    const v = VERSES[Math.floor(Date.now() / 86400000) % VERSES.length];
    const filters = [['all', 'All'], ['active', 'Praying'], ['answered', '⭐ Answered'], ['mine', 'Mine']];
    shell(`
      <div class="card verse-card">
        <div class="label">Verse of the day</div>
        <div class="text">“${esc(v[0])}”</div>
        <div class="ref">— ${esc(v[1])} (WEB)</div>
      </div>
      <div class="stats-grid" style="margin-top:14px">
        <div class="stat-box"><span class="emoji">🔥</span><div><div class="big">${s.streak}</div><div class="muted small">Day streak</div></div></div>
        <div class="stat-box"><span class="emoji">📖</span><div><div class="big">${s.active}</div><div class="muted small">Active requests</div></div></div>
        <div class="stat-box"><span class="emoji">⭐</span><div><div class="big">${s.answered}</div><div class="muted small">Prayers answered</div></div></div>
        <div class="stat-box"><span class="emoji">🤲</span><div><div class="big">${s.needsPrayer}</div><div class="muted small">Need a first prayer</div></div></div>
      </div>
      ${!s.prayedToday ? `<div class="card" style="margin-top:14px;background:var(--orange-light);border-color:#ffd38a">
        <b>🔥 Keep your streak alive!</b> <span class="muted">Pray for someone today.</span></div>` : ''}
      <div class="section-head"><h2>Prayer requests</h2><a class="btn btn-primary btn-sm" href="#/new">➕ New</a></div>
      <div class="chips">${filters.map(([k, l]) => `<button class="chip ${state.filter === k ? 'on' : ''}" data-f="${k}">${l}</button>`).join('')}</div>
      <div id="list">
        ${requests.length ? requests.map(requestCard).join('') : `
          <div class="empty"><div class="big">🕊️</div><h3>Nothing here yet</h3>
          <p>${state.filter === 'mine' ? 'You have not shared a request yet.' : 'Be the first to share a prayer request.'}</p></div>`}
      </div>
      <div class="rail-inline" style="margin-top:24px">${railHtml()}</div>`, railHtml());
    document.querySelectorAll('[data-f]').forEach((b) => (b.onclick = () => { state.filter = b.dataset.f; render(); }));
  }

  function requestForm(r) {
    const cat = r ? r.category : 'General';
    return `
      <div class="back" onclick="history.back()">← Back</div>
      <h1>${r ? 'Edit request' : 'New prayer request'}</h1>
      <p class="muted">${r ? 'Update the details of your request.' : 'Share what you would like the cell to pray for.'}</p>
      <form id="rf" class="card" style="margin-top:14px">
        <div class="field"><label>Title</label><input class="input" name="title" maxlength="100" placeholder="e.g. Healing for my mum" value="${esc(r?.title)}" required /></div>
        <div class="field"><label>Category</label>
          <div class="cat-pick">${state.categories.map((c) => `<button type="button" class="chip ${c === cat ? 'on' : ''}" data-cat="${esc(c)}">${esc(c)}</button>`).join('')}</div>
        </div>
        <div class="field"><label>Details</label><textarea class="input" name="body" maxlength="2000" placeholder="Share as much as you are comfortable with…" required>${esc(r?.body)}</textarea></div>
        <div class="error-msg" id="err"></div>
        <button class="btn btn-primary btn-block" type="submit">${r ? 'Save changes' : 'Post request'}</button>
      </form>`;
  }

  function bindRequestForm(existing) {
    const f = document.getElementById('rf');
    let category = existing ? existing.category : 'General';
    f.querySelectorAll('[data-cat]').forEach((b) => (b.onclick = () => {
      category = b.dataset.cat;
      f.querySelectorAll('[data-cat]').forEach((x) => x.classList.toggle('on', x === b));
    }));
    f.onsubmit = async (e) => {
      e.preventDefault();
      const body = { title: f.title.value, body: f.body.value, category };
      try {
        const { request } = existing
          ? await api('/requests/' + existing.id, { method: 'PUT', body })
          : await api('/requests', { method: 'POST', body });
        toast(existing ? 'Request updated ✏️' : 'Request posted — the cell will pray with you 🙏');
        go('#/request/' + request.id);
      } catch (err) { document.getElementById('err').textContent = err.message; }
    };
  }

  async function viewNew() {
    if (!state.stats) await refreshStats();
    shell(requestForm(null));
    bindRequestForm(null);
    document.querySelector('[name=title]').focus();
  }

  async function viewEdit(id) {
    const { request } = await api('/requests/' + id);
    if (!request.is_mine) { toast('Only the person who posted this can edit it', true); return go('#/request/' + id); }
    shell(requestForm(request));
    bindRequestForm(request);
  }

  async function viewRequest(id) {
    const [{ request: r, prayers }] = await Promise.all([api('/requests/' + id), state.stats ? null : refreshStats()]);
    const answered = r.status === 'answered';
    shell(`
      <a class="back" href="#/">← Prayer wall</a>
      <div class="card ${answered ? 'req-card answered' : ''}" style="${answered ? 'margin:0' : ''}">
        <div class="head" style="display:flex;gap:10px;align-items:center">
          <span class="avatar">${esc(r.author_avatar)}</span>
          <div style="flex:1"><b>${esc(r.is_mine ? 'You' : r.author_name)}</b>
            <div class="muted small">${timeAgo(r.created_at)}${r.updated_at !== r.created_at ? ' · edited' : ''}</div></div>
          ${answered ? '<span class="tag answered">⭐ Answered</span>' : '<span class="tag active">Praying</span>'}
        </div>
        <span class="tag cat" style="margin-top:12px">${esc(r.category)}</span>
        <h1 class="detail-title">${esc(r.title)}</h1>
        <div class="detail-body">${esc(r.body)}</div>
        ${answered ? `<div class="answer-box"><b>🙌 Praise report</b> <span class="muted small">· ${timeAgo(r.answered_at)}</span>
          ${r.answer_note ? `<p style="margin-top:6px;white-space:pre-wrap">${esc(r.answer_note)}</p>` : '<p class="muted" style="margin-top:6px">God answered this prayer!</p>'}</div>` : ''}
        ${r.is_mine ? `
          <div class="owner-actions">
            ${answered
              ? '<button class="btn btn-ghost btn-sm" id="reopen">↩ Mark as still praying</button>'
              : '<button class="btn btn-gold btn-sm" id="answer">⭐ Mark answered</button>'}
            <a class="btn btn-ghost btn-sm" href="#/edit/${r.id}">✏️ Edit</a>
            <button class="btn btn-ghost danger btn-sm" id="del">🗑 Delete</button>
          </div>` : ''}
      </div>

      <div class="section-head"><h2>🙏 Prayers (${prayers.length})</h2></div>
      <form id="pf" class="card">
        <div class="field" style="margin-bottom:10px"><textarea class="input" name="body" maxlength="2000" style="min-height:90px"
          placeholder="${r.is_mine ? 'Add an update or your own prayer…' : `Write your prayer for ${esc(r.author_name)}…`}" required></textarea></div>
        <div class="error-msg" id="perr"></div>
        <button class="btn btn-blue btn-block" type="submit">🙏 Pray</button>
      </form>
      <div class="card" style="margin-top:14px">
        ${prayers.length ? prayers.map((p) => `
          <div class="prayer">
            <span class="avatar">${esc(p.author_avatar)}</span>
            <div class="bubble">
              <div class="meta"><b>${esc(p.is_mine ? 'You' : p.author_name)}</b><span class="muted small">${timeAgo(p.created_at)}</span></div>
              <div class="text">${esc(p.body)}</div>
              ${p.is_mine ? `<button class="link-btn" data-delp="${p.id}">Remove</button>` : ''}
            </div>
          </div>`).join('') : '<div class="empty" style="padding:20px"><div class="big" style="font-size:44px">🤲</div><p>No prayers yet — be the first to pray.</p></div>'}
      </div>`);

    document.getElementById('pf').onsubmit = async (e) => {
      e.preventDefault();
      const f = e.target;
      const before = state.stats?.streak ?? 0;
      try {
        await api(`/requests/${r.id}/prayers`, { method: 'POST', body: { body: f.body.value } });
        await refreshStats();
        await viewRequest(id);
        const s = state.stats;
        if (s.streak > before) celebrate('🔥', `${s.streak} day streak!`, 'Thank you for standing in the gap for your brother or sister in Christ.');
        else toast('Amen! Your prayer was added 🙏');
      } catch (err) { document.getElementById('perr').textContent = err.message; }
    };

    document.querySelectorAll('[data-delp]').forEach((b) => (b.onclick = async () => {
      if (!(await confirmBox('Remove prayer?', 'Your prayer will be removed from this request.', 'Remove'))) return;
      try { await api('/prayers/' + b.dataset.delp, { method: 'DELETE' }); await refreshStats(); viewRequest(id); }
      catch (err) { toast(err.message, true); }
    }));

    if (!r.is_mine) return;
    document.getElementById('del').onclick = async () => {
      if (!(await confirmBox('Delete this request?', 'The request and all prayers on it will be permanently removed.', 'Delete'))) return;
      try { await api('/requests/' + r.id, { method: 'DELETE' }); toast('Request deleted'); go('#/'); }
      catch (err) { toast(err.message, true); }
    };
    const ans = document.getElementById('answer');
    if (ans) ans.onclick = () => modal(`
        <h2>⭐ Prayer answered!</h2>
        <p class="muted">Share a short praise report with the cell (optional).</p>
        <textarea class="input" id="note" maxlength="1000" placeholder="How did God answer?"></textarea>
        <div class="actions"><button class="btn btn-ghost" data-no>Cancel</button><button class="btn btn-gold" data-yes>Praise God!</button></div>`,
      (el, close) => {
        el.querySelector('#note').focus();
        el.querySelector('[data-no]').onclick = close;
        el.querySelector('[data-yes]').onclick = async () => {
          try {
            await api(`/requests/${r.id}/answer`, { method: 'POST', body: { answered: true, note: el.querySelector('#note').value } });
            close(); await refreshStats(); await viewRequest(id);
            confetti();
            celebrate('🙌', 'Praise the Lord!', 'Your request is now marked as answered. The cell will rejoice with you.');
          } catch (err) { toast(err.message, true); }
        };
      });
    const re = document.getElementById('reopen');
    if (re) re.onclick = async () => {
      try { await api(`/requests/${r.id}/answer`, { method: 'POST', body: { answered: false } }); await refreshStats(); viewRequest(id); }
      catch (err) { toast(err.message, true); }
    };
  }

  async function viewMembers() {
    const admin = state.user.is_admin;
    const [{ members }, , invite] = await Promise.all([
      api('/members'), state.stats ? null : refreshStats(), admin ? api('/invite') : null,
    ]);
    shell(`
      <h1>👥 Cell members</h1>
      <p class="muted">${members.length} member${members.length === 1 ? '' : 's'} can see the prayer wall.</p>
      ${admin ? `
        <div class="card invite-card" style="margin-top:14px">
          <h3>📨 Cell invite code</h3>
          <p class="muted small">Members sign up on the <b>Create an account</b> page using this code.</p>
          <div class="invite-code" id="code">${esc(invite.code)}</div>
          <div class="owner-actions" style="margin-top:12px">
            <button class="btn btn-blue btn-sm" id="copyInvite">📋 Copy invite message</button>
            <button class="btn btn-ghost btn-sm" id="newCode">🔄 New code</button>
          </div>
        </div>
        <form id="mf" class="card" style="margin-top:14px">
          <h3>Add a member</h3>
          <p class="muted small">New members log in with the default password <b>p@ssw0rd</b> and must change it on first login.</p>
          <div class="field"><label>Full name</label><input class="input" name="display_name" maxlength="40" placeholder="e.g. Grace Tan" required /></div>
          <div class="field"><label>Username</label><input class="input" name="username" maxlength="30" placeholder="e.g. grace" autocapitalize="none" required /></div>
          <label style="display:flex;gap:8px;align-items:center;margin-bottom:12px"><input type="checkbox" name="is_admin" /> Also make them a System Admin (can manage members)</label>
          <div class="error-msg" id="merr"></div>
          <button class="btn btn-primary btn-block" type="submit">Add member</button>
        </form>` : ''}
      <div class="card" style="margin-top:14px">
        ${members.map((m) => `
          <div class="member-row">
            <span class="avatar">${esc(m.avatar)}</span>
            <div class="info">
              <b>${esc(m.display_name)}</b> ${m.is_admin ? '<span class="tag mine">System Admin</span>' : ''}
              <div class="muted small">@${esc(m.username)}${admin && m.must_change_password ? ' · hasn’t set a password yet' : ''}</div>
            </div>
            ${admin && m.id !== state.user.id ? `
              <div class="actions">
                <button class="btn btn-ghost btn-sm" data-leader="${m.id}" data-on="${m.is_admin ? 0 : 1}">${m.is_admin ? 'Remove admin' : 'Make admin'}</button>
                <button class="btn btn-ghost btn-sm" data-reset="${m.id}" data-name="${esc(m.display_name)}">Reset password</button>
                <button class="btn btn-ghost danger btn-sm" data-remove="${m.id}" data-name="${esc(m.display_name)}">Remove</button>
              </div>` : ''}
          </div>`).join('')}
      </div>`);

    if (!admin) return;
    const inviteMsg = (code) => `Join our cell prayer wall 🙏\n${location.origin}${location.pathname}#/register\nInvite code: ${code}`;
    document.getElementById('copyInvite').onclick = async () => {
      const text = inviteMsg(document.getElementById('code').textContent);
      try { await navigator.clipboard.writeText(text); toast('Invite copied — paste it in your cell chat'); }
      catch { modal(`<h3>Copy this invite</h3><textarea class="input" readonly>${esc(text)}</textarea>`, (el) => el.querySelector('textarea').select()); }
    };
    document.getElementById('newCode').onclick = async () => {
      if (!(await confirmBox('Make a new code?', 'The old code will stop working. Members who already signed up are not affected.', 'New code', false))) return;
      try { const { code } = await api('/invite/regenerate', { method: 'POST' }); document.getElementById('code').textContent = code; toast('New invite code ready'); }
      catch (err) { toast(err.message, true); }
    };
    document.querySelectorAll('[data-leader]').forEach((b) => (b.onclick = async () => {
      try { await api(`/members/${b.dataset.leader}/leader`, { method: 'POST', body: { is_admin: b.dataset.on === '1' } }); viewMembers(); }
      catch (err) { toast(err.message, true); }
    }));
    const f = document.getElementById('mf');
    f.display_name.oninput = () => {
      if (f.username.dataset.touched) return;
      f.username.value = f.display_name.value.trim().toLowerCase().split(/\s+/)[0]?.replace(/[^a-z0-9._-]/g, '') || '';
    };
    f.username.oninput = () => (f.username.dataset.touched = '1');
    f.onsubmit = async (e) => {
      e.preventDefault();
      try {
        await api('/members', { method: 'POST', body: { display_name: f.display_name.value, username: f.username.value, is_admin: f.is_admin.checked } });
        const u = f.username.value.trim().toLowerCase();
        await viewMembers();
        celebrate('🎉', 'Member added!', `They can log in as "${u}" with password p@ssw0rd.`);
      } catch (err) { document.getElementById('merr').textContent = err.message; }
    };
    document.querySelectorAll('[data-reset]').forEach((b) => (b.onclick = async () => {
      if (!(await confirmBox('Reset password?', `${b.dataset.name}'s password will be reset to p@ssw0rd and they will be logged out.`, 'Reset', false))) return;
      try { await api(`/members/${b.dataset.reset}/reset-password`, { method: 'POST' }); toast('Password reset to p@ssw0rd'); viewMembers(); }
      catch (err) { toast(err.message, true); }
    }));
    document.querySelectorAll('[data-remove]').forEach((b) => (b.onclick = async () => {
      if (!(await confirmBox('Remove member?', `${b.dataset.name} will no longer be able to log in, and all of their requests and prayers will be permanently deleted.`, 'Remove'))) return;
      try { await api('/members/' + b.dataset.remove, { method: 'DELETE' }); toast('Member removed'); viewMembers(); }
      catch (err) { toast(err.message, true); }
    }));
  }

  async function viewProfile() {
    if (!state.stats) await refreshStats();
    const u = state.user;
    let avatar = u.avatar;
    shell(`
      <div style="text-align:center;margin-bottom:14px">
        <span class="avatar lg" id="bigav">${esc(u.avatar)}</span>
        <h1 style="margin-top:10px">${esc(u.display_name)}</h1>
        <p class="muted">@${esc(u.username)} ${u.is_admin ? '· System Admin' : ''}</p>
      </div>
      <form id="prof" class="card">
        <h3>Your profile</h3>
        <div class="field"><label>Display name</label><input class="input" name="display_name" maxlength="40" value="${esc(u.display_name)}" required /></div>
        <div class="field"><label>Avatar</label><div class="avatar-pick">
          ${state.avatars.map((a) => `<button type="button" class="${a === u.avatar ? 'on' : ''}" data-av="${esc(a)}">${esc(a)}</button>`).join('')}
        </div></div>
        <button class="btn btn-primary btn-block" type="submit">Save profile</button>
      </form>
      <div class="card"><h3>Change password</h3>${passwordForm(false)}</div>
      <div style="margin-top:18px"><button class="btn btn-ghost danger btn-block" id="logout">Log out</button></div>`);

    const pf = document.getElementById('prof');
    pf.querySelectorAll('[data-av]').forEach((b) => (b.onclick = () => {
      avatar = b.dataset.av;
      pf.querySelectorAll('[data-av]').forEach((x) => x.classList.toggle('on', x === b));
      document.getElementById('bigav').textContent = avatar;
    }));
    pf.onsubmit = async (e) => {
      e.preventDefault();
      try {
        const { user } = await api('/me', { method: 'PATCH', body: { display_name: pf.display_name.value, avatar } });
        state.user = user; toast('Profile saved ✨'); viewProfile();
      } catch (err) { toast(err.message, true); }
    };
    bindPasswordForm(() => { toast('Password changed 🔐'); viewProfile(); });
    document.getElementById('logout').onclick = logout;
  }

  async function logout() {
    try { await api('/logout', { method: 'POST' }); } catch { /* ignore */ }
    state.user = null; state.stats = null;
    go('#/login');
  }

  async function loadMe() {
    if (!window.PrayerAPI.hasToken()) return (state.user = null);
    try { state.user = (await window.PrayerAPI.call('/me')).user; } catch { state.user = null; }
  }

  function viewNotConfigured() {
    $app.innerHTML = `
      <div class="auth-wrap"><div class="auth-card">
        <div class="mascot">🛠️</div>
        <h1>Almost ready</h1>
        <p class="muted">This prayer wall is not connected to its database yet. Add your Supabase project URL and key to <b>public/config.js</b> (see the README).</p>
      </div></div>`;
  }

  // ---------- router ----------
  async function render() {
    document.getElementById('modal-root').innerHTML = '';
    const hash = location.hash || '#/';
    if (!window.PrayerAPI.configured) return viewNotConfigured();
    if (!state.user) await loadMe();
    if (!state.user) return hash === '#/register' ? viewRegister(false) : viewLogin();
    if (state.user.must_change_password) return viewChangePassword();
    if (hash === '#/login' || hash === '#/register' || hash === '#/change-password') return go('#/');
    window.scrollTo(0, 0);
    try {
      let m;
      if (hash === '#/' || hash === '#') await viewDashboard();
      else if (hash === '#/new') await viewNew();
      else if ((m = hash.match(/^#\/request\/(\d+)$/))) await viewRequest(m[1]);
      else if ((m = hash.match(/^#\/edit\/(\d+)$/))) await viewEdit(m[1]);
      else if (hash === '#/members') await viewMembers();
      else if (hash === '#/profile') await viewProfile();
      else go('#/');
    } catch (err) {
      if (state.user) { toast(err.message, true); if (/not found/i.test(err.message)) go('#/'); }
    }
  }

  window.addEventListener('hashchange', render);
  render();
})();
