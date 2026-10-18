// Giao diện: định tuyến theo #, các màn hình (trang chủ, chơi với máy, sảnh online, phòng, xếp hạng, lịch sử).
import { BoardView } from './board.js';
import { discordInstanceId, inDiscord, startDiscord } from './discord.js';
import { Board, CIRCLE, CROSS, DEFAULT_RULESET, EMPTY, LEVELS, RULESETS, chooseMove } from './core.js';
import {
    api, currentRoom, forgetSeat, getPlayer, loadApiBase, rememberSeat, seatIn, setCurrentRoom, setPlayerName, watchRoom
} from './api.js';

const main = document.getElementById('view');
const toastEl = document.getElementById('toast');
const nameInput = document.getElementById('name');

const WHO = { A: CIRCLE, B: CROSS };
const SEAT_LABEL = { A: 'quân tròn đỏ', B: 'chữ X xanh' };
const REASON_LABEL = {
    five: 'năm quân liên tiếp',
    resign: 'đầu hàng hoặc rời phòng',
    full: 'bàn đã đầy',
    abandoned: 'bỏ dở vì không ai chơi tiếp'
};

// Tỉ số trong phiên chơi với máy (giữ khi đổi trang, mất khi tải lại)
const aiScore = { me: 0, ai: 0, draw: 0 };

let routeId = 0;
let teardown = null;

// ------------------------------------------------------------------ tiện ích DOM

// Tạo phần tử; chữ luôn đưa vào bằng textContent nên tên người chơi không thể chèn HTML
function h(tag, props = {}, ...children) {
    const el = document.createElement(tag);
    for (const [key, value] of Object.entries(props || {})) {
        if (value == null || value === false) continue;
        if (key === 'class') el.className = value;
        else if (key === 'text') el.textContent = value;
        else if (key.startsWith('on')) el.addEventListener(key.slice(2), value);
        else el.setAttribute(key, value === true ? '' : value);
    }
    for (const child of children.flat()) {
        if (child == null || child === false) continue;
        el.append(child instanceof Node ? child : document.createTextNode(String(child)));
    }
    return el;
}

function button(label, onClick, kind = 'ghost', extra = {}) {
    return h('button', { class: `btn ${kind}`, type: 'button', onclick: onClick, ...extra, text: label });
}

function page(...children) {
    return h('div', { class: 'page' }, ...children);
}

function header(title, subtitle) {
    return h('header', { class: 'page-head' }, h('h2', { text: title }), subtitle ? h('p', { class: 'muted', text: subtitle }) : null);
}

function toast(message) {
    toastEl.textContent = message;
    toastEl.classList.add('show');
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => toastEl.classList.remove('show'), 2800);
}

function formatTime(ms) {
    if (!ms) return '';
    return new Date(ms).toLocaleString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function setTeardown(fn) {
    teardown = fn;
}

function loading(message = 'Đang tải…') {
    return h('p', { class: 'muted center', text: message });
}

function errorBox(message) {
    return h('div', { class: 'card empty' }, h('p', { text: message }), h('a', { class: 'btn ghost', href: '#/lobby', text: 'Về sảnh' }));
}

// Vào phòng rồi chuyển sang màn phòng. Ghi nhớ chỗ ngồi (seat là null nếu là người xem)
async function enterRoom(request) {
    try {
        const data = await request();
        rememberSeat(data.room.id, data.seat, data.code || null);
        if (data.seat) setCurrentRoom(data.room.id);
        location.hash = `#/room/${data.room.id}`;
    } catch (error) {
        toast(error.message);
    }
}

// Trong Discord: phòng của kênh đang mở Activity (mọi người trong kênh vào chung)
function instanceCard() {
    if (!discordInstanceId) return null;
    const player = getPlayer();
    return h('div', { class: 'card instance-card' },
        h('div', { class: 'grow' },
            h('strong', { text: 'Phòng của kênh này' }),
            h('p', { class: 'muted small', text: 'Mọi người trong kênh đang mở Caro cùng vào một phòng: hai người đầu đánh, những người khác xem.' })
        ),
        button('Vào phòng kênh', () => enterRoom(() => api('POST', '/api/instance-room', {
            instanceId: discordInstanceId,
            playerId: player.id,
            name: getPlayer().name,
            rules: readRules()
        })), 'primary')
    );
}

// ------------------------------------------------------------------ trang chủ

function homeView() {
    const my = routeId;
    const roomId = currentRoom();
    const resume = h('div', { class: 'resume' });
    if (roomId) {
        api('GET', `/api/rooms/${encodeURIComponent(roomId)}`)
            .then(() => {
                if (my === routeId) resume.append(h('a', { class: 'card resume-card', href: `#/room/${roomId}` }, h('strong', { text: 'Quay lại ván đang chơi' }), h('span', { class: 'muted', text: 'Phòng của bạn vẫn còn mở.' })));
            })
            .catch(() => forgetSeat(roomId));
    }

    return page(
        h('section', { class: 'hero' },
            h('div', { class: 'hero-mark', 'aria-hidden': 'true' }, h('span', { class: 'o', text: '●' }), h('span', { class: 'x', text: '✕' })),
            h('h1', { text: 'Caro' }),
            h('p', { class: 'lead', text: 'Năm quân liên tiếp trên bàn 20 × 15. Đấu với máy ở bốn mức độ, ghép trận với người chơi khác, hoặc xem trực tiếp các ván đang diễn ra.' })
        ),
        resume,
        instanceCard(),
        h('nav', { class: 'menu' },
            menuTile('Chơi với máy', 'Bốn mức độ, từ dễ đến cao thủ', '#/ai', 'vs'),
            menuTile('Chơi online', 'Ghép nhanh, tạo phòng hoặc vào bằng mã', '#/lobby', 'on'),
            menuTile('Bảng xếp hạng', 'Ai thắng nhiều nhất trong các ván online', '#/leaderboard', 'top'),
            menuTile('Lịch sử ván đấu', 'Xem lại các ván online đã kết thúc', '#/history', 'his'),
            menuTile('Luật chơi', 'Cách thắng, ví dụ về bịt hai đầu và mẹo', '#/rules', 'rule')
        )
    );
}

function menuTile(title, description, href, icon) {
    return h('a', { class: 'tile', href },
        h('span', { class: `tile-icon ${icon}`, 'aria-hidden': 'true' }),
        h('strong', { text: title }),
        h('span', { class: 'muted', text: description })
    );
}

// ------------------------------------------------------------------ chơi với máy

function aiSetupView() {
    const last = localStorage.getItem('caro.level') || 'hard';
    const links = [];
    const picker = rulesPicker(readRules(), key => {
        localStorage.setItem('caro.rules', key);
        for (const a of links) a.href = `#/ai/${a.dataset.level}/${key}`;
    });
    return page(
        header('Chơi với máy', 'Chọn mức và luật, rồi bắt đầu. Bạn đi trước bằng quân tròn đỏ.'),
        picker.el,
        h('div', { class: 'levels' },
            Object.entries(LEVELS).map(([key, level]) => {
                const link = h('a', {
                    class: `card level-card ${key === last ? 'recent' : ''}`,
                    href: `#/ai/${key}/${picker.value()}`,
                    'data-level': key,
                    onclick: () => localStorage.setItem('caro.level', key)
                }, h('strong', { text: level.label }), h('span', { class: 'muted', text: level.description }));
                links.push(link);
                return link;
            })
        ),
        h('p', { class: 'muted small', text: 'Ván với máy không được lưu lên bảng xếp hạng. Tỉ số trong phiên này được giữ khi bạn chuyển trang.' }),
        h('a', { class: 'link', href: '#/rules', text: 'Xem luật chơi và mẹo →' })
    );
}

// ------------------------------------------------------------------ luật chơi và hướng dẫn

// Chọn bộ luật: các nút, và mô tả của bộ đang chọn. onPick(key) khi người chơi đổi
function rulesPicker(initial, onPick) {
    let current = initial;
    const note = h('p', { class: 'muted small' });
    const chips = h('div', { class: 'chips', role: 'group', 'aria-label': 'Luật chơi' });
    const draw = () => {
        chips.replaceChildren(...Object.entries(RULESETS).map(([key, rule]) => h('button', {
            class: `chip ${key === current ? 'on' : ''}`,
            type: 'button',
            'aria-pressed': String(key === current),
            onclick: () => {
                current = key;
                onPick(key);
                draw();
            },
            text: rule.label
        })));
        note.textContent = RULESETS[current].description;
    };
    draw();
    return { el: h('div', { class: 'rules-picker' }, chips, note), value: () => current };
}

function readRules() {
    const saved = localStorage.getItem('caro.rules');
    return RULESETS[saved] ? saved : DEFAULT_RULESET;
}

const row = (from, to, who, y = 2) => Array.from({ length: to - from + 1 }, (_, i) => ({ x: from + i, y, who }));
const LINE = (from, to, y = 2) => Array.from({ length: to - from + 1 }, (_, i) => [from + i, y]);

// Các nước của một đường thẳng n quân từ (x0, y0) theo hướng (dx, dy)
const lineMoves = (x0, y0, dx, dy, n, who) => Array.from({ length: n }, (_, i) => ({ x: x0 + i * dx, y: y0 + i * dy, who }));
const lineCells = (x0, y0, dx, dy, n) => Array.from({ length: n }, (_, i) => [x0 + i * dx, y0 + i * dy]);

// Ví dụ trên bàn 9 × 5 (bàn thật 20 × 15 nhưng ví dụ chỉ cần một đoạn)
const RULE_EXAMPLES = [
    {
        title: 'Năm quân, hai đầu trống',
        verdict: 'win',
        text: 'Năm quân liên tiếp và hai đầu đều trống: thắng ngay.',
        moves: row(2, 6, CIRCLE),
        line: LINE(2, 6)
    },
    {
        title: 'Năm quân bị bịt hai đầu',
        verdict: 'none',
        text: 'Năm quân nhưng cả hai đầu đều là quân đối phương: không được tính, ván tiếp tục.',
        moves: [...row(2, 6, CIRCLE), { x: 1, y: 2, who: CROSS }, { x: 7, y: 2, who: CROSS }]
    },
    {
        title: 'Năm quân, chỉ bị bịt một đầu',
        verdict: 'win',
        text: 'Chỉ một đầu có quân đối phương, đầu kia còn trống: vẫn thắng (bộ Chuẩn).',
        moves: [...row(2, 6, CIRCLE), { x: 1, y: 2, who: CROSS }],
        line: LINE(2, 6)
    },
    {
        title: 'Năm quân chạm mép bàn',
        verdict: 'win',
        text: 'Mép bàn không phải quân đối phương, nên một đầu là mép bàn và đầu kia bị bịt vẫn thắng.',
        moves: [...row(4, 8, CIRCLE), { x: 3, y: 2, who: CROSS }],
        line: LINE(4, 8)
    }
];

// Ba bộ luật, cùng một thế cờ: thể hiện chỗ khác nhau
const RULE_VARIANTS = [
    {
        key: 'standard',
        verdict: 'win',
        caption: 'Một đầu bị bịt, đầu kia trống',
        moves: [...row(2, 6, CIRCLE), { x: 1, y: 2, who: CROSS }],
        line: LINE(2, 6)
    },
    {
        key: 'strict',
        verdict: 'none',
        caption: 'Cùng thế cờ: chỉ cần một đầu bị bịt',
        moves: [...row(2, 6, CIRCLE), { x: 1, y: 2, who: CROSS }]
    },
    {
        key: 'exact',
        verdict: 'none',
        caption: 'Sáu quân liên tiếp',
        moves: row(1, 6, CIRCLE)
    }
];

const RULE_TIPS = [
    'Nếu đối phương có bốn quân liên tiếp và còn một đầu trống, hãy chặn ngay đầu đó. Để sót là họ thắng ở nước kế tiếp.',
    'Bịt một đầu chưa đủ để vô hiệu hoá một dãy năm (bộ Chuẩn). Muốn dãy đó không được tính, phải có quân của bạn ở cả hai đầu.',
    'Tạo hai đường bốn quân cùng lúc (thế kép) để đối phương chỉ kịp chặn một đường.',
    'Làm quen luật ở mức Khó trước khi đấu online. Dùng Hoàn tác để thử lại một thế cờ.'
];

function rulesView() {
    const boards = [];
    // Một hình minh hoạ: bàn nhỏ, có thể tô đường thắng, đánh dấu ô, và chú thích
    const figure = ({ width = 9, height = 5, moves = [], line = null, marks = [], caption = null }) => {
        const host = h('div', { class: 'mini-board', 'aria-hidden': 'true' });
        const board = new BoardView(host, { width, height });
        board.setMoves(moves, { winLine: line });
        board.setMarks(marks);
        boards.push(board);
        return h('figure', { class: 'figure' }, host, caption ? h('figcaption', { class: 'muted small', text: caption }) : null);
    };
    const badge = verdict => h('span', { class: `badge ${verdict}`, text: verdict === 'win' ? 'Thắng' : 'Không tính' });

    const section = (title, ...children) => h('section', { class: 'card rules-section' }, h('h3', { text: title }), ...children);
    const list = items => h('ul', { class: 'rules-list' }, items.map(text => h('li', { text })));
    const grid = (...children) => h('div', { class: 'examples' }, children);

    const directions = [
        { caption: 'Hàng ngang', moves: lineMoves(1, 3, 1, 0, 5, CIRCLE), line: lineCells(1, 3, 1, 0, 5) },
        { caption: 'Hàng dọc', moves: lineMoves(3, 1, 0, 1, 5, CIRCLE), line: lineCells(3, 1, 0, 1, 5) },
        { caption: 'Đường chéo', moves: lineMoves(1, 1, 1, 1, 5, CIRCLE), line: lineCells(1, 1, 1, 1, 5) }
    ];

    const examples = RULE_EXAMPLES.map(example => h('article', { class: 'card example' },
        figure({ moves: example.moves, line: example.line || null }),
        h('div', { class: 'example-body' },
            badge(example.verdict),
            h('h4', { text: example.title }),
            h('p', { class: 'muted', text: example.text })
        )
    ));

    const variants = RULE_VARIANTS.map(variant => h('article', { class: 'card example' },
        figure({ moves: variant.moves, line: variant.line || null, caption: variant.caption }),
        h('div', { class: 'example-body' },
            badge(variant.verdict),
            h('h4', { text: RULESETS[variant.key].label }),
            h('p', { class: 'muted', text: RULESETS[variant.key].description })
        )
    ));

    setTeardown(() => boards.forEach(board => board.destroy()));

    return page(
        header('Luật chơi và hướng dẫn', 'Đọc nhanh trong một phút, có hình minh hoạ.'),
        section('Mục tiêu',
            h('p', { text: 'Xếp được năm quân của mình liên tiếp theo hàng ngang, hàng dọc hoặc đường chéo trước đối phương.' }),
            h('div', { class: 'figures' }, directions.map(d => figure({ width: 7, height: 7, moves: d.moves, line: d.line, caption: d.caption })))),
        section('Cách đánh',
            list([
                'Bàn 20 × 15 ô. Hai bên lần lượt đặt một quân vào ô trống. Quân tròn đỏ đi trước, chữ X xanh đi sau.',
                'Chạm (hoặc nhấp) vào ô trống để đánh. Vòng vàng đánh dấu nước vừa đi.'
            ]),
            h('div', { class: 'figures' }, figure({
                moves: [{ x: 3, y: 2, who: CIRCLE }, { x: 5, y: 1, who: CROSS }, { x: 4, y: 2, who: CIRCLE }],
                caption: 'Quân tròn đỏ vừa đi (vòng vàng), chữ X xanh đi tiếp'
            }))),
        section('Thắng và thua',
            list([
                'Năm quân liên tiếp cùng màu thì người đó thắng ngay. Dãy dài hơn năm quân cũng thắng (bộ Chuẩn và Bịt một đầu).',
                'Ngoại lệ: nếu năm quân liên tiếp bị đối phương bịt cả hai đầu thì không được tính. Ván tiếp tục.',
                'Chỉ cần một đầu trống hoặc chạm mép bàn thì năm quân vẫn được tính (bộ Chuẩn).'
            ]),
            grid(...examples)),
        section('Chọn luật khi bắt đầu',
            h('p', { text: 'Trước khi chơi, bạn chọn một bộ luật. Ván với máy và ván online đều theo bộ luật đã chọn; trong phòng online, bộ luật được ghi trên phòng và ai vào phòng sau thì theo luật đó.' }),
            grid(...variants),
            h('p', { class: 'muted small', text: 'Bộ Chuẩn là mặc định.' })),
        section('Hoà',
            h('p', { text: 'Bàn đầy mà không ai có năm quân hợp lệ thì hoà.' })),
        section('Chơi với máy',
            list([
                'Chọn mức (Dễ, Vừa, Khó, Cao thủ) và bộ luật ở mục Với máy. Mức Khó là mặc định.',
                'Hoàn tác bỏ hai nước gần nhất khi ván còn đang chơi.',
                'Ván với máy không được tính lên bảng xếp hạng.'
            ])),
        section('Chơi online',
            list([
                'Ghép nhanh vào phòng đang chờ, tạo phòng công khai, hoặc tạo phòng riêng và gửi mã 5 ký tự cho bạn bè.',
                'Người khác có thể xem trực tiếp ván đang đấu.',
                'Đầu hàng hoặc rời phòng khi đang chơi được tính là thua.',
                'Khi ván kết thúc, bấm Đấu lại. Cần cả hai bên đồng ý, và đổi chỗ để mỗi bên được đi trước một lần.'
            ])),
        section('Bảng xếp hạng và lịch sử',
            list([
                'Chỉ tính ván online. Xếp theo số ván thắng, rồi đến số ván thua ít hơn.',
                'Lịch sử lưu các ván online đã kết thúc. Mở Xem lại để xem từng nước; có thể dùng phím mũi tên.'
            ])),
        section('Mẹo',
            list(RULE_TIPS.slice(0, 1)),
            h('div', { class: 'figures' }, figure({
                moves: [...lineMoves(2, 2, 1, 0, 4, CROSS), { x: 1, y: 2, who: CIRCLE }],
                marks: [{ x: 6, y: 2 }],
                caption: 'Chữ X có bốn quân, ô được đánh dấu là đầu còn trống: phải chặn ngay ở đó'
            })),
            list(RULE_TIPS.slice(1)))
    );
}

function aiGameView(levelKey, rulesKey) {
    const level = LEVELS[levelKey];
    if (!level) return errorBox('Không có mức độ này.');
    const rules = RULESETS[rulesKey] ? rulesKey : DEFAULT_RULESET;
    const my = routeId;
    const gameBoard = new Board(20, 15, RULESETS[rules]);
    let moves = [];
    let busy = false, over = false, winLine = null, generation = 0;

    const boardHost = h('div', { class: 'board-host' });
    const view = new BoardView(boardHost, { onTap: (x, y) => humanMove(x, y) });
    const statusEl = h('p', { class: 'status' });
    const resultEl = h('div', { class: 'result' });
    const scoreEl = h('p', { class: 'score' });
    const undoBtn = button('Hoàn tác', undo, 'ghost');
    const newBtn = button('Ván mới', newGame, 'primary');
    const panel = h('aside', { class: 'panel card' },
        h('div', { class: 'eyebrow', text: `Mức ${level.label} · Luật ${RULESETS[rules].label}` }),
        h('a', { class: 'link small', href: '#/ai', text: 'Đổi mức hoặc luật' }),
        statusEl,
        scoreEl,
        resultEl,
        h('div', { class: 'actions' }, undoBtn, newBtn),
        h('p', { class: 'muted small', text: 'Bạn là quân tròn đỏ và đi trước. Hoàn tác bỏ hai nước gần nhất khi ván còn đang chơi.' })
    );

    function refresh() {
        view.setMoves(moves, { winLine });
        view.setInteractive(!busy && !over, CIRCLE);
        statusEl.textContent = over ? '' : busy ? 'Máy đang suy nghĩ…' : 'Lượt của bạn';
        scoreEl.textContent = `Bạn ${aiScore.me} · Máy ${aiScore.ai} · Hoà ${aiScore.draw}`;
        undoBtn.disabled = busy || over || moves.length < 2;
        newBtn.classList.toggle('primary', over);
        newBtn.classList.toggle('ghost', !over);
    }

    function place(x, y, who) {
        gameBoard.place(x, y, who);
        moves.push({ x, y, who });
        return gameBoard.winAt(x, y);
    }

    function humanMove(x, y) {
        if (busy || over || gameBoard.get(x, y) !== EMPTY) return;
        const win = place(x, y, CIRCLE);
        if (win) return finish('me', win.cells);
        if (gameBoard.isFull()) return finish('draw');
        aiTurn();
    }

    async function aiTurn() {
        const gen = generation;
        busy = true;
        refresh();
        await new Promise(resolve => setTimeout(resolve, 280));
        if (gen !== generation || my !== routeId) return;
        const [x, y] = chooseMove(gameBoard, CROSS, levelKey);
        const win = place(x, y, CROSS);
        busy = false;
        if (win) return finish('ai', win.cells);
        if (gameBoard.isFull()) return finish('draw');
        refresh();
    }

    function finish(who, cells = null) {
        over = true;
        winLine = cells;
        aiScore[who === 'me' ? 'me' : who === 'ai' ? 'ai' : 'draw']++;
        const text = who === 'me' ? 'Bạn thắng!' : who === 'ai' ? 'Máy thắng!' : 'Hoà, bàn đã đầy.';
        resultEl.replaceChildren(h('strong', { class: `verdict ${who}`, text }), h('p', { class: 'muted', text: who === 'ai' ? 'Lần sau hãy chặn sớm hơn.' : '' }));
        refresh();
    }

    function undo() {
        if (busy || over || moves.length < 2) return;
        for (let i = 0; i < 2; i++) {
            const last = moves.pop();
            gameBoard.remove(last.x, last.y);
        }
        refresh();
    }

    function newGame() {
        generation++;
        busy = false;
        over = false;
        winLine = null;
        moves = [];
        gameBoard.cells.fill(EMPTY);
        gameBoard.count = 0;
        resultEl.replaceChildren();
        refresh();
    }

    refresh();
    setTeardown(() => view.destroy());
    return page(h('div', { class: 'game-page' }, boardHost, panel));
}

// ------------------------------------------------------------------ sảnh online

function lobbyView() {
    const my = routeId;
    const player = getPlayer();
    const rulesChoice = rulesPicker(readRules(), key => localStorage.setItem('caro.rules', key));
    const rules = () => rulesChoice.value();
    const waitingEl = h('div', { class: 'list' }, loading());
    const liveEl = h('div', { class: 'list' }, loading());
    const codeInput = h('input', { class: 'input', placeholder: 'Mã phòng riêng (5 ký tự)', maxlength: '5', autocomplete: 'off', 'aria-label': 'Mã phòng riêng' });

    async function enter(request) {
        try {
            const data = await request();
            rememberSeat(data.room.id, data.seat, data.code || null);
            setCurrentRoom(data.room.id);
            location.hash = `#/room/${data.room.id}`;
        } catch (error) {
            toast(error.message);
        }
    }

    function listRow(title, detail, action) {
        return h('div', { class: 'row' }, h('div', {}, h('strong', { text: title }), h('div', { class: 'muted small', text: detail })), action);
    }

    async function refresh() {
        try {
            const { waiting, live } = await api('GET', '/api/rooms');
            if (my !== routeId) return;
            waitingEl.replaceChildren(...(waiting.length ? waiting.map(room => {
                const mine = seatIn(room.id);
                const action = mine
                    ? button('Mở phòng', () => (location.hash = `#/room/${room.id}`), 'ghost')
                    : button('Vào', () => enter(() => api('POST', `/api/rooms/${room.id}/join`, { playerId: player.id, name: getPlayer().name })), 'primary');
                return listRow(`${room.seats.A} đang chờ`, `${mine ? 'Phòng của bạn' : `Tạo lúc ${formatTime(room.createdAt)}`} · Luật ${RULESETS[room.rules]?.label || ''}`, action);
            }) : [h('p', { class: 'muted', text: 'Chưa có phòng nào đang chờ. Hãy tạo phòng hoặc ghép nhanh.' })]));
            liveEl.replaceChildren(...(live.length ? live.map(room => listRow(
                `${room.seats.A} và ${room.seats.B}`,
                `${room.moveCount} nước · ${room.watchers} người đang theo dõi · Luật ${RULESETS[room.rules]?.label || ''}`,
                button('Xem trực tiếp', () => (location.hash = `#/room/${room.id}`), 'ghost')
            )) : [h('p', { class: 'muted', text: 'Hiện chưa có ván nào đang diễn ra.' })]));
        } catch (error) {
            if (my === routeId) toast(error.message);
        }
    }

    const timer = setInterval(refresh, 4000);
    setTeardown(() => clearInterval(timer));
    refresh();

    return page(
        header('Chơi online', 'Chọn luật rồi ghép nhanh, hoặc tạo phòng và gửi mã cho bạn bè. Ai vào phòng sau thì theo luật của phòng.'),
        instanceCard(),
        rulesChoice.el,
        h('div', { class: 'card actions-grid' },
            button('Ghép nhanh', () => enter(() => api('POST', '/api/match', { playerId: player.id, name: getPlayer().name, rules: rules() })), 'primary'),
            button('Tạo phòng công khai', () => enter(() => api('POST', '/api/rooms', { playerId: player.id, name: getPlayer().name, isPrivate: false, rules: rules() })), 'ghost'),
            button('Tạo phòng riêng', () => enter(() => api('POST', '/api/rooms', { playerId: player.id, name: getPlayer().name, isPrivate: true, rules: rules() })), 'ghost')
        ),
        h('form', {
            class: 'card join-code',
            onsubmit: event => {
                event.preventDefault();
                const code = codeInput.value.trim();
                if (code.length !== 5) return toast('Mã phòng có 5 ký tự');
                enter(() => api('POST', '/api/rooms/join-code', { playerId: player.id, name: getPlayer().name, code }));
            }
        }, codeInput, h('button', { class: 'btn primary', type: 'submit', text: 'Vào phòng' })),
        h('section', { class: 'section' }, h('h3', { text: 'Phòng đang chờ đối thủ' }), waitingEl),
        h('section', { class: 'section' }, h('h3', { text: 'Ván đang diễn ra (xem trực tiếp)' }), liveEl)
    );
}

// ------------------------------------------------------------------ phòng online (chơi hoặc xem)

function roomView(roomId) {
    const my = routeId;
    const me = getPlayer();
    let seat = seatIn(roomId)?.seat ?? null;
    let code = seatIn(roomId)?.code ?? null;
    let view = null, busy = false, missing = false, stop = null;

    const boardHost = h('div', { class: 'board-host' });
    const board = new BoardView(boardHost, { onTap: (x, y) => sendMove(x, y) });
    const panel = h('aside', { class: 'panel card' }, loading());
    setTeardown(() => {
        stop?.();
        board.destroy();
    });

    function nameOf(s) {
        return view?.seats[s] || (s === 'A' ? 'Người chơi A' : 'Người chơi B');
    }

    function resultText() {
        const { winner, reason } = view.result;
        if (!winner) return 'Ván đã bị huỷ.';
        if (winner === 'draw') return 'Hoà, bàn đã đầy.';
        const five = reason === 'five';
        if (seat) {
            if (winner === seat) return five ? 'Bạn thắng với năm quân liên tiếp!' : 'Bạn thắng! Đối phương đã đầu hàng hoặc rời phòng.';
            return five ? 'Bạn thua, đối phương có năm quân liên tiếp.' : 'Bạn thua vì đã đầu hàng hoặc rời phòng.';
        }
        const name = nameOf(winner);
        return five ? `${name} thắng với năm quân liên tiếp.` : `${name} thắng vì đối phương đầu hàng hoặc rời phòng.`;
    }

    function statusText() {
        if (view.status === 'waiting') return seat === 'A' ? 'Đang chờ đối thủ vào phòng…' : 'Đang chờ…';
        if (view.status === 'playing') {
            if (seat && view.turn === seat) return 'Lượt của bạn';
            return `Đang chờ ${nameOf(view.turn)} đi`;
        }
        return resultText();
    }

    function actions() {
        const buttons = [];
        const leave = () => leaveRoom();
        if (view.status === 'waiting' && seat === 'A') {
            buttons.push(button('Rời phòng', leave, 'danger'));
        } else if (view.status === 'playing') {
            if (seat) buttons.push(button('Đầu hàng', resign, 'danger'));
            else buttons.push(button('Về sảnh', () => (location.hash = '#/lobby'), 'ghost'));
        } else if (view.status === 'finished') {
            if (seat) {
                const asked = view.rematch.includes(seat);
                const rematchBtn = button(
                    asked ? 'Đã xin đấu lại' : 'Đấu lại',
                    rematch,
                    'primary',
                    { disabled: asked || !view.seats.A || !view.seats.B || busy }
                );
                buttons.push(rematchBtn, button('Rời phòng', leave, 'danger'));
            } else {
                buttons.push(button('Về sảnh', () => (location.hash = '#/lobby'), 'ghost'));
            }
        }
        if (view.matchId && view.status === 'finished') {
            buttons.push(h('a', { class: 'btn ghost', href: `#/history/${view.matchId}`, text: 'Xem lại ván' }));
        }
        return h('div', { class: 'actions' }, buttons);
    }

    function render() {
        if (my !== routeId) return;
        if (!view) return;
        const interactive = !busy && view.status === 'playing' && seat !== null && view.turn === seat;
        board.setMoves(view.moves, { winLine: view.winLine });
        board.setInteractive(interactive, seat ? WHO[seat] : CIRCLE);

        const role = seat ? `Bạn là ${SEAT_LABEL[seat]}` : 'Đang xem';
        const players = ['A', 'B'].map(s => {
            const name = view.seats[s];
            const active = view.status === 'playing' && view.turn === s;
            return h('div', { class: `player ${active ? 'active' : ''}` },
                h('span', { class: `symbol ${s === 'A' ? 'circle' : 'cross'}`, 'aria-hidden': 'true' }),
                h('div', { class: 'grow' },
                    h('strong', { text: name || 'Đang chờ…' }),
                    h('div', { class: 'muted small', text: s === 'A' ? 'Đi trước' : 'Đi sau' })
                ),
                seat === s ? h('span', { class: 'tag', text: 'bạn' }) : null
            );
        });

        panel.replaceChildren(...[
            h('div', { class: 'eyebrow', text: `${view.channel ? 'Phòng kênh Discord' : view.isPrivate ? 'Phòng riêng' : 'Phòng công khai'} · ${role} · Luật ${RULESETS[view.rules]?.label || ''}` }),
            seat === 'A' && view.status === 'waiting' && code
                ? h('div', { class: 'code-box' },
                    h('span', { class: 'muted small', text: 'Gửi mã này cho bạn bè' }),
                    h('strong', { class: 'code', text: code }),
                    button('Sao chép', () => copy(code), 'ghost small-btn'))
                : null,
            h('div', { class: 'players' }, players),
            h('p', { class: 'status', text: statusText() }),
            actions(),
            h('p', { class: 'muted small', text: `Đang theo dõi: ${view.watchers} · ${view.moves.length} nước` })
        ].filter(Boolean));
    }

    function applyView(next) {
        if (my !== routeId) return;
        view = next;
        if (seat && !view.seats[seat]) {
            // chỗ của mình đã trống (đã rời phòng)
            forgetSeat(roomId);
            seat = null;
            code = null;
        }
        render();
    }

    async function sendMove(x, y) {
        if (busy || !seat) return;
        busy = true;
        render();
        try {
            const data = await api('POST', `/api/rooms/${roomId}/move`, { playerId: me.id, x, y });
            applyView(data.room);
        } catch (error) {
            toast(error.message);
            await refreshView();
        } finally {
            busy = false;
            render();
        }
    }

    async function resign() {
        if (!confirm('Đầu hàng ván này?')) return;
        try {
            applyView((await api('POST', `/api/rooms/${roomId}/resign`, { playerId: me.id })).room);
        } catch (error) {
            toast(error.message);
        }
    }

    async function rematch() {
        try {
            applyView((await api('POST', `/api/rooms/${roomId}/rematch`, { playerId: me.id })).room);
        } catch (error) {
            toast(error.message);
        }
    }

    async function leaveRoom() {
        if (view.status === 'playing' && seat && !confirm('Rời khi đang chơi sẽ tính là đầu hàng. Rời phòng?')) return;
        try {
            if (seat) await api('POST', `/api/rooms/${roomId}/leave`, { playerId: me.id });
        } catch (error) {
            toast(error.message);
        }
        forgetSeat(roomId);
        location.hash = '#/lobby';
    }

    async function refreshView() {
        try {
            const { room } = await api('GET', `/api/rooms/${roomId}`);
            applyView(room);
        } catch (error) {
            missing = true;
            forgetSeat(roomId);
            if (my === routeId) panel.replaceChildren(errorBox(error.message));
        }
    }

    refreshView().then(() => {
        if (my !== routeId || missing) return;
        if (seat) setCurrentRoom(roomId);
        stop = watchRoom(roomId, {
            onState: next => applyView(next),
            onClosed: () => {
                forgetSeat(roomId);
                toast('Phòng đã đóng');
                if (my === routeId) location.hash = '#/lobby';
            },
            onError: () => toast('Mất kết nối với máy chủ. Đang thử lại…')
        });
    });

    return page(h('div', { class: 'game-page' }, boardHost, panel));
}

function copy(text) {
    navigator.clipboard?.writeText(text).then(() => toast('Đã sao chép mã phòng'), () => toast(`Mã phòng: ${text}`));
}

// ------------------------------------------------------------------ bảng xếp hạng

function leaderboardView() {
    const my = routeId;
    const me = getPlayer();
    const body = h('tbody', {}, h('tr', {}, h('td', { colspan: '7', class: 'muted center', text: 'Đang tải…' })));
    api('GET', '/api/leaderboard?limit=100')
        .then(({ players }) => {
            if (my !== routeId) return;
            if (!players.length) {
                body.replaceChildren(h('tr', {}, h('td', { colspan: '7', class: 'muted center', text: 'Chưa có ván online nào kết thúc.' })));
                return;
            }
            body.replaceChildren(...players.map((p, i) => h('tr', { class: p.name === me.name ? 'me' : '' },
                h('td', { class: 'rank' }, i < 3 ? h('span', { class: `medal m${i + 1}`, text: String(i + 1) }) : String(i + 1)),
                h('td', { class: 'name', text: p.name }),
                h('td', { class: 'num', text: String(p.wins) }),
                h('td', { class: 'num', text: String(p.losses) }),
                h('td', { class: 'num', text: String(p.draws) }),
                h('td', { class: 'num', text: String(p.games) }),
                h('td', { class: 'num', text: `${p.rate}%` })
            )));
        })
        .catch(error => {
            if (my === routeId) body.replaceChildren(h('tr', {}, h('td', { colspan: '7', class: 'muted center', text: error.message })));
        });

    return page(
        header('Bảng xếp hạng', 'Xếp theo số ván thắng, rồi theo số ván thua ít hơn. Chỉ tính các ván online.'),
        h('div', { class: 'card table-wrap' },
            h('table', { class: 'table' },
                h('thead', {}, h('tr', {}, ...['#', 'Người chơi', 'Thắng', 'Thua', 'Hoà', 'Số ván', 'Tỉ lệ'].map(t => h('th', { text: t })))),
                body
            )
        )
    );
}

// ------------------------------------------------------------------ lịch sử và xem lại

function resultLabel(match) {
    if (match.winner === 'draw') return 'Hoà';
    if (!match.winner) return 'Bỏ dở';
    return `${match.players[match.winner]} thắng`;
}

function historyView() {
    const my = routeId;
    const list = h('div', { class: 'list' }, loading());
    api('GET', '/api/matches?limit=50')
        .then(({ matches }) => {
            if (my !== routeId) return;
            if (!matches.length) {
                list.replaceChildren(h('p', { class: 'muted', text: 'Chưa có ván online nào. Các ván đã kết thúc sẽ hiện ở đây.' }));
                return;
            }
            list.replaceChildren(...matches.map(match => h('div', { class: 'row match' },
                h('div', { class: 'grow' },
                    h('div', { class: 'match-players' },
                        h('strong', { text: match.players.A || 'Người chơi A' }),
                        h('span', { class: 'muted', text: ' đấu với ' }),
                        h('strong', { text: match.players.B || 'Người chơi B' })),
                    h('div', { class: 'muted small', text: `${resultLabel(match)}${match.reason ? ' · ' + (REASON_LABEL[match.reason] || match.reason) : ''} · Luật ${RULESETS[match.rules]?.label || 'Chuẩn'} · ${match.moveCount} nước · ${formatTime(match.endedAt)}` })
                ),
                h('a', { class: 'btn ghost', href: `#/history/${match.id}`, text: 'Xem lại' })
            )));
        })
        .catch(error => {
            if (my === routeId) list.replaceChildren(h('p', { class: 'muted', text: error.message }));
        });

    return page(header('Lịch sử ván đấu', 'Các ván online đã kết thúc, mới nhất trước.'), list);
}

function replayView(matchId) {
    const my = routeId;
    const host = h('div', { class: 'board-host' });
    const board = new BoardView(host, {});
    const info = h('div', { class: 'panel card' }, loading());
    const counter = h('span', { class: 'muted small' });
    const slider = h('input', { type: 'range', min: '0', value: '0', class: 'slider', 'aria-label': 'Nước đi' });
    let moves = [], step = 0, winner = null, timer = null;

    function show() {
        const current = moves.slice(0, step);
        let winLine = null;
        if (step === moves.length && winner && winner !== 'draw' && step > 0) {
            const last = moves[step - 1];
            winLine = Board.replay(current, 20, 15, RULESETS[match.rules]).winAt(last.x, last.y)?.cells || null;
        }
        board.setMoves(current, { winLine });
        counter.textContent = `${step} / ${moves.length}`;
        slider.value = String(step);
    }

    function go(to) {
        step = Math.max(0, Math.min(moves.length, to));
        if (step === moves.length) stopPlay();
        show();
    }

    function stopPlay() {
        clearInterval(timer);
        timer = null;
        playBtn.textContent = 'Phát';
    }

    function togglePlay() {
        if (timer) return stopPlay();
        if (step >= moves.length) go(0);
        playBtn.textContent = 'Dừng';
        timer = setInterval(() => go(step + 1), 700);
    }

    const playBtn = button('Phát', togglePlay, 'primary');
    const controls = h('div', { class: 'replay-controls' },
        button('⏮', () => go(0), 'ghost icon-btn', { 'aria-label': 'Về đầu' }),
        button('◀', () => go(step - 1), 'ghost icon-btn', { 'aria-label': 'Lùi một nước' }),
        playBtn,
        button('▶', () => go(step + 1), 'ghost icon-btn', { 'aria-label': 'Tiến một nước' }),
        button('⏭', () => go(moves.length), 'ghost icon-btn', { 'aria-label': 'Đến cuối' }),
        counter
    );
    slider.addEventListener('input', () => go(Number(slider.value)));

    const onKey = event => {
        if (event.target instanceof HTMLInputElement && event.target !== slider) return;
        if (event.key === 'ArrowLeft') go(step - 1);
        else if (event.key === 'ArrowRight') go(step + 1);
    };
    document.addEventListener('keydown', onKey);
    setTeardown(() => {
        stopPlay();
        document.removeEventListener('keydown', onKey);
        board.destroy();
    });

    api('GET', `/api/matches/${encodeURIComponent(matchId)}`)
        .then(({ match }) => {
            if (my !== routeId) return;
            moves = match.moves;
            winner = match.winner;
            slider.max = String(moves.length);
            step = moves.length;
            info.replaceChildren(
                h('div', { class: 'eyebrow', text: match.isPrivate ? 'Phòng riêng' : 'Phòng công khai' }),
                h('h3', { text: `${match.players.A || 'Người chơi A'} đấu với ${match.players.B || 'Người chơi B'}` }),
                h('p', { class: 'status', text: resultLabel(match) }),
                h('p', { class: 'muted', text: `${REASON_LABEL[match.reason] || match.reason || ''} · Luật ${RULESETS[match.rules]?.label || 'Chuẩn'}` }),
                h('p', { class: 'muted small', text: `Bắt đầu ${formatTime(match.startedAt)} · kết thúc ${formatTime(match.endedAt)}` }),
                h('a', { class: 'link small', href: '#/history', text: '← Về danh sách' })
            );
            show();
        })
        .catch(error => {
            if (my === routeId) info.replaceChildren(errorBox(error.message));
        });

    return page(h('div', { class: 'game-page' }, host, h('div', { class: 'stack' }, info, h('div', { class: 'card replay' }, controls, slider))));
}

// ------------------------------------------------------------------ định tuyến

function notFound() {
    return errorBox('Không tìm thấy trang này.');
}

function route() {
    teardown?.();
    teardown = null;
    routeId++;
    const [name, arg, arg2] = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean).map(decodeURIComponent);
    let view;
    switch (name) {
        case undefined: view = homeView(); break;
        case 'ai': view = arg ? aiGameView(arg, arg2) : aiSetupView(); break;
        case 'lobby': view = lobbyView(); break;
        case 'room': view = arg ? roomView(arg) : notFound(); break;
        case 'leaderboard': view = leaderboardView(); break;
        case 'history': view = arg ? replayView(arg) : historyView(); break;
        case 'rules': view = rulesView(); break;
        default: view = notFound();
    }
    main.replaceChildren(view);
    document.querySelectorAll('.topnav a').forEach(a => a.classList.toggle('active', a.dataset.route === name));
    window.scrollTo({ top: 0 });
}

// ------------------------------------------------------------------ khởi động

nameInput.value = getPlayer().name;
nameInput.addEventListener('change', () => {
    const player = setPlayerName(nameInput.value);
    nameInput.value = player.name;
    toast(`Tên của bạn: ${player.name}`);
});
window.addEventListener('hashchange', route);
// Trong Discord: đợi đăng nhập (tối đa 6 giây) để người chơi là tài khoản Discord ngay từ đầu
await loadApiBase();

// Trong Discord: đăng nhập chạy nền (hộp xác nhận của Discord có thể mất vài giây). Xong thì đổi sang tên Discord
if (inDiscord()) {
    startDiscord().then(result => {
        if (result.player) {
            nameInput.value = result.player.name;
            toast(`Đã đăng nhập Discord: ${result.player.name}`);
        } else if (result.error) {
            toast(`Chưa đăng nhập được Discord (${result.error}). Đang chơi với tên tự đặt.`);
        }
    });
}
nameInput.value = getPlayer().name;
route();
