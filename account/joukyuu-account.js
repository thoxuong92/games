// Tài khoản Joukyuu phía game (docs/ACCOUNTS.md): ghép vào script của mỗi game (như net.js), hoặc nạp
// bằng <script> trên trang /account/. Không import gì, chỉ định nghĩa JOUKYUU_ACCOUNTS và JoukyuuAccount.
//
//   const account = JoukyuuAccount.init(app, {
//       game: 'chinese-chess',                     // mã game: tiến trình lưu theo mã này
//       localOnly: ['playerId', 'discordId'],      // khoá của app.save chỉ thuộc thiết bị (không đồng bộ)
//       discordToken: () => Promise<string>        // trong Discord Activity: access token (scope identify)
//   });
//   await account.ready;                           // đã có phiên (khách hoặc tài khoản) và đã đồng bộ lần đầu
//   account.account                                // { id, displayName, username, email, discord, guest }
//   account.token                                  // gửi cho máy chủ game (xác thực qua service binding)
//   account.openPanel()                            // bảng đăng nhập / đăng ký / liên kết Discord
//   app.on('account:change', account => ...)      // đăng nhập, đăng xuất, đổi tên
//
// Phiên lưu ở localStorage 'joukyuu:session': mọi game trên game.joukyuu.com dùng chung, đăng nhập một lần.
// Tiến trình (app.save) đồng bộ lên máy chủ vài giây sau mỗi lần game ghi, và lấy về khi mở game / quay
// lại tab. Hai nơi cùng đổi (máy này và thiết bị khác) thì hỏi người chơi giữ bản nào.

const JOUKYUU_ACCOUNTS = {
    url: 'https://joukyuu-accounts.fish-hunter-server.workers.dev',
    site: 'https://game.joukyuu.com',
    // App Discord dùng cho "Đăng nhập bằng Discord" trên web (redirect: <site>/account/discord.html)
    discordClientId: '1561234898528903188'
};

/** JSON với khoá sắp xếp: hai bản giống nhau cho cùng một chuỗi dù thứ tự khoá khác */
function jkStable(value) {
    if (Array.isArray(value)) return `[${value.map(jkStable).join(',')}]`;
    if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${jkStable(value[k])}`).join(',')}}`;
    return JSON.stringify(value ?? null);
}

function jkStorage() {
    try {
        return globalThis.localStorage ?? null;
    } catch {
        return null;
    }
}

class JoukyuuAccount {
    /** Một tài khoản cho mỗi app (gọi lại trả về cái đã có) */
    static init(app, options) {
        app.account ||= new JoukyuuAccount(app, options);
        return app.account;
    }

    constructor(app, { game, localOnly = [], discordToken = null } = {}) {
        this.app = app;
        this.game = game;
        this.localOnly = new Set(localOnly);
        this.discordToken = discordToken;
        this.storage = jkStorage();
        this.account = null;
        this.status = '';
        this.inDiscord = !!globalThis.Platform?.discord?.instanceId;
        this.ready = this._start().catch(err => {
            console.warn('Tài khoản:', err?.message || err);
            this.status = 'Chưa kết nối được máy chủ tài khoản (chơi tạm trên máy này).';
            return null;
        });
        const doc = globalThis.document;
        this._onVisible = () => { if (doc && !doc.hidden && this.account) this.sync(); };
        doc?.addEventListener?.('visibilitychange', this._onVisible);
    }

    // ------------------------------------------------------------ máy chủ

    get base() {
        const params = new URLSearchParams(globalThis.location?.search || '');
        if (params.get('acc')) return params.get('acc').replace(/\/$/, '');
        if (this.inDiscord) return `${globalThis.location.origin}/.proxy/acc`;
        return JOUKYUU_ACCOUNTS.url;
    }

    get token() {
        try { return this.storage?.getItem('joukyuu:session') || ''; } catch { return ''; }
    }

    set token(value) {
        try {
            if (value) this.storage?.setItem('joukyuu:session', value);
            else this.storage?.removeItem('joukyuu:session');
        } catch { /* không lưu được: phiên chỉ còn trong lần chơi này */ }
        this._memoryToken = value;
    }

    async api(method, path, data) {
        const headers = { 'content-type': 'application/json' };
        const token = this.token || this._memoryToken;
        if (token) headers.authorization = `Bearer ${token}`;
        const res = await fetch(`${this.base}${path}`, { method, headers, body: data === undefined ? undefined : JSON.stringify(data) });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw Object.assign(new Error(body.message || `Lỗi ${res.status}`), { status: res.status, code: body.error, body });
        return body;
    }

    _signedIn(out) {
        if (out.token) this.token = out.token;
        this._setAccount(out.account);
        return out.account;
    }

    _setAccount(account) {
        this.account = account;
        this.app.fire?.('account:change', account);
    }

    // ------------------------------------------------------------ phiên

    async _start() {
        if (this.token) {
            try {
                this._setAccount((await this.api('GET', '/v1/me')).account);
            } catch (err) {
                if (err.status !== 401) throw err;
                this.token = '';
            }
        }
        // Trong Discord: đăng nhập bằng Discord (tạo tài khoản, hoặc gắn vào tài khoản đang dùng)
        if (this.inDiscord && this.discordToken && !this.account?.discord) {
            try {
                const accessToken = await this.discordToken();
                if (accessToken) this._signedIn(await this.api('POST', '/v1/auth/discord', { accessToken }));
            } catch (err) {
                console.warn('Tài khoản: đăng nhập Discord', err?.message || err);
            }
        }
        if (!this.account) this._signedIn(await this.api('POST', '/v1/auth/guest', {}));
        await this._hookSave();
        await this.sync();
        return this.account;
    }

    async register({ username, email, password, displayName }) {
        const out = this._signedIn(await this.api('POST', '/v1/auth/register', { username: username || undefined, email: email || undefined, password, displayName }));
        await this.sync();
        return out;
    }

    async login(login, password) {
        const out = this._signedIn(await this.api('POST', '/v1/auth/login', { login, password }));
        await this.sync({ afterLogin: true });
        return out;
    }

    async loginDiscord() {
        const accessToken = this.inDiscord ? await this.discordToken?.() : await this._discordPopup();
        if (!accessToken) throw new Error('Chưa đăng nhập được Discord.');
        const out = this._signedIn(await this.api('POST', '/v1/auth/discord', { accessToken }));
        await this.sync({ afterLogin: true });
        return out;
    }

    async logout() {
        await this.api('POST', '/v1/auth/logout').catch(() => {});
        this.token = '';
        this._signedIn(await this.api('POST', '/v1/auth/guest', {}));
        // tiến trình trên máy giữ nguyên; tài khoản khách mới bắt đầu từ đó
        await this.sync();
    }

    async rename(displayName) {
        this._setAccount((await this.api('PATCH', '/v1/me', { displayName })).account);
    }

    /** Web: cửa sổ đăng nhập Discord (OAuth implicit), trang /account/discord.html gửi token về */
    _discordPopup() {
        return new Promise((resolve, reject) => {
            const state = Math.random().toString(36).slice(2) + Date.now().toString(36);
            const redirect = `${JOUKYUU_ACCOUNTS.site}/account/discord.html`;
            const url = `https://discord.com/oauth2/authorize?client_id=${JOUKYUU_ACCOUNTS.discordClientId}&response_type=token&scope=identify`
                + `&redirect_uri=${encodeURIComponent(redirect)}&state=${state}`;
            const popup = globalThis.open?.(url, 'joukyuu-discord', 'width=500,height=760');
            if (!popup) { reject(new Error('Trình duyệt chặn cửa sổ đăng nhập Discord.')); return; }
            const done = (value, error) => {
                globalThis.removeEventListener('message', onMessage);
                clearInterval(watch);
                if (error) reject(error); else resolve(value);
            };
            const onMessage = e => {
                if (e.origin !== JOUKYUU_ACCOUNTS.site && e.origin !== globalThis.location.origin) return;
                if (e.data?.type !== 'joukyuu-discord' || e.data.state !== state) return;
                done(e.data.accessToken || '', e.data.error ? new Error(e.data.error) : null);
            };
            globalThis.addEventListener('message', onMessage);
            const watch = setInterval(() => { if (popup.closed) done('', new Error('Đã đóng cửa sổ Discord.')); }, 500);
        });
    }

    // ------------------------------------------------------------ đồng bộ tiến trình

    get _syncKey() {
        return `joukyuu:sync:${this.account?.id}:${this.game}`;
    }

    _syncState() {
        try { return JSON.parse(this.storage?.getItem(this._syncKey) || 'null'); } catch { return null; }
    }

    _setSyncState(version, data) {
        try { this.storage?.setItem(this._syncKey, JSON.stringify({ version, hash: jkStable(data) })); } catch { /* */ }
    }

    /** Phần tiến trình được đồng bộ (bỏ các khoá chỉ thuộc thiết bị) */
    _shared() {
        const d = this.app.save?.data || { values: {}, counters: {}, scores: [] };
        const values = {};
        for (const [k, v] of Object.entries(d.values || {})) if (!this.localOnly.has(k)) values[k] = v;
        return { values, counters: { ...d.counters }, scores: [...(d.scores || [])] };
    }

    _isEmpty(data) {
        return !data || (!Object.keys(data.values || {}).length && !Object.keys(data.counters || {}).length && !(data.scores || []).length);
    }

    async _hookSave() {
        const save = this.app.save;
        if (!save || save.__joukyuu) return;
        save.__joukyuu = true;
        await save.ready?.catch?.(() => {});
        const flush = save.flush.bind(save);
        save.flush = (...args) => {
            const out = flush(...args);
            if (!this._applying) this._schedulePush();
            return out;
        };
    }

    _schedulePush() {
        clearTimeout(this._pushTimer);
        this._pushTimer = setTimeout(() => this.sync(), 3000);
    }

    /** Thay tiến trình trên máy bằng bản của tài khoản (giữ các khoá chỉ thuộc thiết bị) */
    _apply(data) {
        const save = this.app.save;
        if (!save) return;
        const keepLocal = {};
        for (const k of this.localOnly) if (k in (save.data?.values || {})) keepLocal[k] = save.data.values[k];
        this._applying = true;
        try {
            save._read({ values: { ...(data?.values || {}), ...keepLocal }, counters: data?.counters || {}, scores: data?.scores || [] });
            save._announce?.();
            save.flush();
        } finally {
            this._applying = false;
        }
        this.app.fire?.('save:loaded', save);
    }

    /**
     * Đối chiếu tiến trình trên máy với tài khoản: đẩy lên, lấy về, hoặc hỏi người chơi khi cả hai đổi.
     * Gọi lúc mở game, sau đăng nhập, khi quay lại tab và vài giây sau mỗi lần game ghi.
     */
    async sync({ afterLogin = false } = {}) {
        if (!this.account || !this.app.save) return;
        if (this._syncing) { this._syncAgain = true; return this._syncing; }
        this._syncing = (async () => {
            try {
                const remote = await this.api('GET', `/v1/save/${this.game}`);
                const local = this._shared();
                const localHash = jkStable(local);
                const st = this._syncState();
                const changedHere = !this._isEmpty(local) && (!st || st.hash !== localHash);
                if (!remote.version) {
                    if (!this._isEmpty(local)) await this._push(local, 0);
                } else if (st && st.version === remote.version) {
                    if (changedHere) await this._push(local, remote.version);
                } else if (jkStable(remote.data) === localHash) {
                    this._setSyncState(remote.version, remote.data);
                } else if (!changedHere || this._isEmpty(local)) {
                    this._apply(remote.data);
                    this._setSyncState(remote.version, remote.data);
                } else {
                    // cả máy này và tài khoản đều có tiến trình khác nhau
                    const keepHere = await this.askConflict(remote, afterLogin);
                    if (keepHere) await this._push(local, remote.version);
                    else { this._apply(remote.data); this._setSyncState(remote.version, remote.data); }
                }
                this.status = `Đã đồng bộ lúc ${new Date().toLocaleTimeString()}`;
            } catch (err) {
                this.status = 'Chưa đồng bộ được, sẽ thử lại.';
                console.warn('Tài khoản: đồng bộ', err?.message || err);
            }
        })();
        await this._syncing;
        this._syncing = null;
        if (this._syncAgain) { this._syncAgain = false; await this.sync(); }
    }

    async _push(local, baseVersion) {
        try {
            const out = await this.api('PUT', `/v1/save/${this.game}`, { data: local, baseVersion });
            this._setSyncState(out.version, local);
        } catch (err) {
            if (err.status !== 409) throw err;
            // thiết bị khác vừa ghi: đối chiếu lại với bản mới đó
            const keepHere = await this.askConflict(err.body, false);
            if (keepHere) {
                const out = await this.api('PUT', `/v1/save/${this.game}`, { data: local, baseVersion: err.body.version });
                this._setSyncState(out.version, local);
            } else {
                this._apply(err.body.data);
                this._setSyncState(err.body.version, err.body.data);
            }
        }
    }

    /** Hỏi giữ tiến trình nào. true: máy này. Game có thể thay hàm này. */
    askConflict(remote, afterLogin) {
        const when = remote.updatedAt ? new Date(remote.updatedAt).toLocaleString() : '';
        return new Promise(resolve => {
            const box = this._modal();
            box.body.innerHTML = '';
            box.body.append(
                this._el('h2', {}, 'Chọn tiến trình'),
                this._el('p', {}, afterLogin
                    ? 'Máy này và tài khoản vừa đăng nhập đều có tiến trình chơi khác nhau. Giữ bản nào?'
                    : `Tiến trình trên tài khoản đã đổi từ thiết bị khác${when ? ` (lúc ${when})` : ''}, trong khi máy này cũng có thay đổi. Giữ bản nào?`),
                this._button('Dùng bản của tài khoản', () => { box.close(); resolve(false); }, 'primary'),
                this._button('Giữ bản trên máy này', () => { box.close(); resolve(true); })
            );
            box.closeButton.style.display = 'none';
        });
    }

    // ------------------------------------------------------------ bảng tài khoản (DOM)

    _el(tag, attrs = {}, text = '') {
        const el = document.createElement(tag);
        for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
        if (text) el.textContent = text;
        return el;
    }

    _button(label, onClick, kind = '') {
        const b = this._el('button', { type: 'button', class: `jk-btn ${kind}` }, label);
        b.addEventListener('click', onClick);
        return b;
    }

    _input(label, type, name, autocomplete) {
        const wrap = this._el('label', { class: 'jk-field' });
        wrap.append(this._el('span', {}, label));
        const input = this._el('input', { type, name, autocomplete, spellcheck: 'false', autocapitalize: 'off' });
        wrap.append(input);
        return { wrap, input };
    }

    _styles() {
        if (document.getElementById('jk-style')) return;
        const css = `
.jk-back{position:fixed;inset:0;z-index:2147483000;background:rgba(5,8,16,.72);display:flex;align-items:center;justify-content:center;padding:16px;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif}
.jk-card{position:relative;width:min(420px,100%);max-height:92vh;overflow:auto;background:#1b2230;color:#eef1f6;border-radius:16px;padding:22px 20px 18px;box-shadow:0 12px 40px rgba(0,0,0,.5)}
.jk-card h2{margin:0 0 10px;font-size:21px}.jk-card p{margin:6px 0 12px;font-size:14.5px;line-height:1.45;color:#c9d0dc}
.jk-x{position:absolute;top:8px;right:10px;background:none;border:0;color:#aab3c2;font-size:26px;cursor:pointer;line-height:1}
.jk-tabs{display:flex;gap:6px;margin:4px 0 12px}.jk-tabs button{flex:1;padding:9px;border:0;border-radius:9px;background:#2a3346;color:#c9d0dc;font-weight:700;cursor:pointer}
.jk-tabs button.on{background:#3b82f6;color:#fff}
.jk-field{display:block;margin:0 0 10px;font-size:13px;color:#aab3c2}.jk-field span{display:block;margin:0 0 4px}
.jk-field input{width:100%;box-sizing:border-box;padding:11px 12px;border-radius:9px;border:1px solid #3a455c;background:#0f141d;color:#fff;font-size:16px}
.jk-btn{display:block;width:100%;margin:8px 0 0;padding:12px;border:0;border-radius:10px;background:#2f3a50;color:#fff;font-size:15.5px;font-weight:700;cursor:pointer}
.jk-btn.primary{background:#16a34a}.jk-btn.discord{background:#5865f2}.jk-btn.danger{background:#7f1d1d}
.jk-btn:disabled{opacity:.6;cursor:default}
.jk-err{color:#fca5a5;font-size:14px;min-height:18px;margin:6px 0 0}.jk-ok{color:#86efac}
.jk-small{font-size:12.5px;color:#8a95a8;margin-top:12px}`;
        const style = this._el('style', { id: 'jk-style' });
        style.textContent = css;
        document.head.append(style);
    }

    _modal() {
        this._styles();
        const back = this._el('div', { class: 'jk-back' });
        const card = this._el('div', { class: 'jk-card', role: 'dialog', 'aria-modal': 'true' });
        const closeButton = this._el('button', { type: 'button', class: 'jk-x', 'aria-label': 'Đóng' }, '×');
        const body = this._el('div');
        card.append(closeButton, body);
        back.append(card);
        // phím bấm trong bảng không tới game
        for (const type of ['keydown', 'keyup', 'pointerdown', 'pointerup', 'touchstart', 'touchend', 'wheel']) {
            back.addEventListener(type, e => e.stopPropagation());
        }
        document.body.append(back);
        const box = { body, closeButton, close: () => back.remove() };
        closeButton.addEventListener('click', box.close);
        back.addEventListener('click', e => { if (e.target === back && closeButton.style.display !== 'none') box.close(); });
        return box;
    }

    /** Bảng tài khoản: khách thì đăng nhập / đăng ký, đã đăng ký thì hồ sơ và liên kết Discord */
    openPanel() {
        if (typeof document === 'undefined') return;
        const box = this._modal();
        const render = () => (this.account && !this.account.guest ? this._profile(box, render) : this._signIn(box, render));
        this.ready.then(render);
        box.body.append(this._el('p', {}, 'Đang tải...'));
    }

    _signIn(box, render) {
        const a = this.account;
        box.body.innerHTML = '';
        box.body.append(
            this._el('h2', {}, 'Tài khoản Joukyuu'),
            this._el('p', {}, a ? `Bạn đang chơi với tên khách "${a.displayName}". Đăng ký hoặc đăng nhập để giữ tiến trình và chơi tiếp trên mọi thiết bị, cả trong Discord.` : this.status)
        );
        const tabs = this._el('div', { class: 'jk-tabs' });
        const form = this._el('form');
        const error = this._el('div', { class: 'jk-err' });
        let mode = 'register';
        const draw = () => {
            form.innerHTML = '';
            tabs.querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.mode === mode));
            if (mode === 'register') {
                const name = this._input('Tên hiển thị trong game', 'text', 'displayName', 'nickname');
                name.input.value = a?.displayName || '';
                const login = this._input('Email hoặc tên đăng nhập', 'text', 'login', 'username');
                const pass = this._input('Mật khẩu (ít nhất 8 ký tự)', 'password', 'password', 'new-password');
                form.append(name.wrap, login.wrap, pass.wrap, this._button('Đăng ký', () => form.requestSubmit(), 'primary'));
                form.onsubmit = e => {
                    e.preventDefault();
                    const who = login.input.value.trim();
                    run(() => this.register({ email: who.includes('@') ? who : '', username: who.includes('@') ? '' : who, password: pass.input.value, displayName: name.input.value }));
                };
            } else {
                const login = this._input('Email hoặc tên đăng nhập', 'text', 'login', 'username');
                const pass = this._input('Mật khẩu', 'password', 'password', 'current-password');
                form.append(login.wrap, pass.wrap, this._button('Đăng nhập', () => form.requestSubmit(), 'primary'));
                form.onsubmit = e => {
                    e.preventDefault();
                    run(() => this.login(login.input.value.trim(), pass.input.value));
                };
            }
        };
        const run = async fn => {
            error.textContent = '';
            form.querySelectorAll('button,input').forEach(el => { el.disabled = true; });
            try {
                await fn();
                render();
            } catch (err) {
                error.textContent = err.message;
                form.querySelectorAll('button,input').forEach(el => { el.disabled = false; });
            }
        };
        for (const [m, label] of [['register', 'Đăng ký'], ['login', 'Đăng nhập']]) {
            const b = this._button(label, () => { mode = m; error.textContent = ''; draw(); });
            b.dataset.mode = m;
            tabs.append(b);
        }
        box.body.append(tabs, form, error,
            this._button('Đăng nhập bằng Discord', () => run(() => this.loginDiscord()), 'discord'),
            this._el('div', { class: 'jk-small' }, 'Tài khoản dùng chung cho mọi game trên game.joukyuu.com.'));
        draw();
    }

    /** Tài khoản chỉ có Discord: thêm email / tên đăng nhập + mật khẩu để đăng nhập ở nơi khác */
    _addLogin(run) {
        const form = this._el('form');
        const login = this._input('Thêm email hoặc tên đăng nhập', 'text', 'login', 'username');
        const pass = this._input('Mật khẩu (ít nhất 8 ký tự)', 'password', 'password', 'new-password');
        form.append(login.wrap, pass.wrap, this._button('Thêm cách đăng nhập', () => form.requestSubmit()));
        form.onsubmit = e => {
            e.preventDefault();
            const who = login.input.value.trim();
            run(() => this.register({ email: who.includes('@') ? who : '', username: who.includes('@') ? '' : who, password: pass.input.value }), 'Đã thêm cách đăng nhập.');
        };
        return [this._el('p', { class: 'jk-small' }, 'Tài khoản này chỉ đăng nhập được bằng Discord. Thêm email hoặc tên đăng nhập để vào từ trình duyệt bất kỳ:'), form];
    }

    _profile(box, render) {
        const a = this.account;
        box.body.innerHTML = '';
        const error = this._el('div', { class: 'jk-err' });
        const run = async (fn, okText) => {
            error.textContent = '';
            error.classList.remove('jk-ok');
            try {
                await fn();
                render();
                if (okText) { box.body.querySelector('.jk-err').textContent = okText; box.body.querySelector('.jk-err').classList.add('jk-ok'); }
            } catch (err) {
                error.textContent = err.message;
            }
        };
        const who = a.username ? `Tên đăng nhập: ${a.username}` : a.email ? `Email: ${a.email}` : 'Đăng nhập bằng Discord';
        const name = this._input('Tên hiển thị trong game', 'text', 'displayName', 'nickname');
        name.input.value = a.displayName;
        box.body.append(
            this._el('h2', {}, a.displayName),
            this._el('p', {}, `${who}${a.discord ? ` · Discord: ${a.discord.name}` : ''}`),
            name.wrap,
            this._button('Lưu tên', () => run(() => this.rename(name.input.value), 'Đã lưu tên.')),
            a.discord ? this._el('p', {}, 'Đã liên kết Discord: tiến trình dùng chung khi chơi trong Discord.')
                : this._button('Liên kết Discord', () => run(() => this.loginDiscord(), 'Đã liên kết Discord.'), 'discord'),
            ...(a.username || a.email ? [] : this._addLogin(run)),
            this._el('p', { class: 'jk-small' }, this.status || ''),
            error,
            this._button('Đăng xuất', () => run(() => this.logout())),
            ...(this.inDiscord ? [] : [this._el('p', { class: 'jk-small' }, `Đổi mật khẩu, xoá tài khoản: ${JOUKYUU_ACCOUNTS.site}/account/`)])
        );
    }
}
