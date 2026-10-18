// Gọi máy chủ, định danh người chơi và nhớ phòng đang chơi (localStorage: chỉ là tiện ích cho trình duyệt này).

const PLAYER_KEY = 'caro.player';
const SEATS_KEY = 'caro.seats';
const ROOM_KEY = 'caro.room';
const MAX_SEATS = 30;

function read(key, fallback) {
    try {
        return JSON.parse(localStorage.getItem(key)) ?? fallback;
    } catch {
        return fallback;
    }
}

function write(key, value) {
    try {
        localStorage.setItem(key, JSON.stringify(value));
    } catch {
        // trình duyệt chặn lưu trữ: vẫn chơi được, chỉ không nhớ phòng
    }
}

function newId() {
    if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}

export function getPlayer() {
    const saved = read(PLAYER_KEY, null);
    if (saved?.id) return saved;
    const player = { id: newId(), name: `Khách ${Math.floor(1000 + Math.random() * 9000)}` };
    write(PLAYER_KEY, player);
    return player;
}

export function setPlayerName(name) {
    const player = getPlayer();
    player.name = String(name || '').trim().slice(0, 20) || player.name;
    write(PLAYER_KEY, player);
    return player;
}

// Chỗ của mình trong một phòng: { seat: 'A' | 'B', code } hoặc null nếu đang xem
export function seatIn(roomId) {
    return read(SEATS_KEY, {})[roomId] || null;
}

export function rememberSeat(roomId, seat, code = null) {
    const seats = read(SEATS_KEY, {});
    seats[roomId] = { seat, code };
    const keys = Object.keys(seats);
    for (const key of keys.slice(0, Math.max(0, keys.length - MAX_SEATS))) delete seats[key];
    write(SEATS_KEY, seats);
}

export function forgetSeat(roomId) {
    const seats = read(SEATS_KEY, {});
    delete seats[roomId];
    write(SEATS_KEY, seats);
    if (read(ROOM_KEY, null) === roomId) localStorage.removeItem(ROOM_KEY);
}

export function currentRoom() {
    return read(ROOM_KEY, null);
}

export function setCurrentRoom(roomId) {
    write(ROOM_KEY, roomId);
}

// Địa chỉ máy chủ API: để trống thì là cùng gốc với trang (Worker, Discord); trang khác (game.joukyuu.com) điền
// apiBase trong config.json
let apiBase = '';

export async function loadApiBase() {
    try {
        const config = await (await fetch('config.json', { cache: 'no-cache' })).json();
        apiBase = String(config.apiBase || '').replace(/\/$/, '');
    } catch {
        // không đọc được cấu hình: dùng cùng gốc với trang
    }
}

// Phiên đăng nhập Discord (chỉ trong Activity). Trong trình duyệt thường thì không có.
let authToken = null;

export function setAuthToken(token) {
    authToken = token;
}

// Dùng tài khoản Discord làm người chơi: cùng id và tên ở mọi thiết bị
export function adoptPlayer(player) {
    write(PLAYER_KEY, { id: player.id, name: player.name });
}

export async function api(method, path, body) {
    const headers = {};
    if (body) headers['Content-Type'] = 'application/json';
    if (authToken) headers.Authorization = `Bearer ${authToken}`;
    const res = await fetch(apiBase + path, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined
    });
    let data = {};
    try {
        data = await res.json();
    } catch {
        // không phải JSON (lỗi mạng phía proxy chẳng hạn)
    }
    if (!res.ok) throw new Error(data.error || `Lỗi ${res.status}`);
    return data;
}

// Nhận trạng thái phòng theo thời gian thực. Trả về hàm huỷ đăng ký
export function watchRoom(roomId, { onState, onClosed, onError }) {
    const source = new EventSource(`${apiBase}/api/rooms/${encodeURIComponent(roomId)}/events`);
    source.addEventListener('state', event => onState(JSON.parse(event.data)));
    source.addEventListener('closed', () => {
        source.close();
        onClosed?.();
    });
    source.onerror = () => {
        // EventSource tự nối lại; chỉ báo khi trình duyệt đã bỏ cuộc
        if (source.readyState === EventSource.CLOSED) onError?.();
    };
    return () => source.close();
}
