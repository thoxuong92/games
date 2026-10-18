// Luật Caro và máy chơi, dùng chung cho trình duyệt và máy chủ (ES module, không phụ thuộc gì).
//
// - Bên đi trước là quân tròn đỏ (CIRCLE), bên đi sau là chữ X xanh (CROSS).
// - Thắng khi có 5 quân liên tiếp theo hàng, cột hoặc đường chéo, trừ khi cả hai đầu là quân đối phương
//   (luật của bản Unity: CheckEnd). Bàn đầy thì hoà.
// - Máy có bốn mức: dễ, vừa (bảng điểm của bản Unity), khó và cao thủ (tìm kiếm alpha-beta có giới hạn độ sâu).

export const EMPTY = 0;
export const CIRCLE = 1;
export const CROSS = 2;
export const WIN_LENGTH = 5;
export const DEFAULT_WIDTH = 20;
export const DEFAULT_HEIGHT = 15;

// Bốn hướng của một đường năm ô: hàng, cột, chéo xuống, chéo lên
const DIRECTIONS = [[0, 1], [1, 0], [1, 1], [1, -1]];
// Điểm của một cửa sổ năm ô chỉ có quân của một bên (k quân)
const SCORE = [0, 1, 10, 120, 1200, 100000];
const DEFENCE_WEIGHT = 1.2;
const WIN_SCORE = 1e7;
// Bảng điểm của bản Unity (TScore / KScore), dùng cho mức "vừa"
const TSCORE = [0, 1, 9, 85, 769];
const KSCORE = [0, 2, 28, 256, 2308];

// Bộ luật người chơi chọn khi bắt đầu ván.
//   blockedEnds: số đầu bị quân đối phương bịt thì năm quân không được tính (2 = cả hai đầu, 1 = một đầu)
//   exact: chỉ đúng năm quân mới thắng; sáu quân trở lên không tính
export const RULESETS = {
    standard: { label: 'Chuẩn', description: 'Năm quân thắng, trừ khi cả hai đầu đều là quân đối phương.', blockedEnds: 2, exact: false },
    strict: { label: 'Bịt một đầu', description: 'Chỉ cần một đầu là quân đối phương thì năm quân không được tính.', blockedEnds: 1, exact: false },
    exact: { label: 'Đúng năm', description: 'Như Chuẩn, nhưng dãy sáu quân trở lên không thắng.', blockedEnds: 2, exact: true }
};
export const DEFAULT_RULESET = 'standard';

export const LEVELS = {
    easy: { label: 'Dễ', description: 'Đi khá ngẫu nhiên, đôi khi bỏ qua nước chặn.' },
    medium: { label: 'Vừa', description: 'Chặn và tấn công theo bảng điểm của bản Unity.' },
    hard: { label: 'Khó', description: 'Nhìn trước hai nước: biết chặn sớm và tạo thế kép.' },
    expert: { label: 'Cao thủ', description: 'Nhìn trước bốn nước, không bỏ sót đòn thắng.' }
};

export const other = who => (who === CIRCLE ? CROSS : CIRCLE);

export class Board {
    constructor(width = DEFAULT_WIDTH, height = DEFAULT_HEIGHT, rules = RULESETS[DEFAULT_RULESET]) {
        this.width = width;
        this.height = height;
        this.rules = rules;
        this.cells = new Uint8Array(width * height);
        this.count = 0; // số nước đã đi
    }

    inside(x, y) {
        return x >= 0 && y >= 0 && x < this.width && y < this.height;
    }

    get(x, y) {
        return this.inside(x, y) ? this.cells[x + this.width * y] : EMPTY;
    }

    isFull() {
        return this.count === this.cells.length;
    }

    place(x, y, who) {
        if (!this.inside(x, y) || this.get(x, y) !== EMPTY) return false;
        this.cells[x + this.width * y] = who;
        this.count++;
        return true;
    }

    remove(x, y) {
        this.cells[x + this.width * y] = EMPTY;
        this.count--;
    }

    // Năm quân liên tiếp qua ô (x, y)? Trả { who, cells } (cells: năm ô thắng) hoặc null (CheckEnd)
    winAt(x, y) {
        for (const [dx, dy] of DIRECTIONS) {
            let sx = x, sy = y;
            while (this.inside(sx - dx, sy - dy)) {
                sx -= dx;
                sy -= dy;
            }
            for (let px = sx, py = sy; this.inside(px + 4 * dx, py + 4 * dy); px += dx, py += dy) {
                const who = this.get(px, py);
                if (who === EMPTY) continue;
                let five = true;
                for (let k = 1; k < 5 && five; k++) five = this.get(px + k * dx, py + k * dy) === who;
                if (!five) continue;
                const before = this.get(px - dx, py - dy), after = this.get(px + 5 * dx, py + 5 * dy);
                const enemy = other(who);
                const blocked = this.rules.blockedEnds === 1 ? before === enemy || after === enemy : before === enemy && after === enemy;
                if (blocked) continue;
                if (this.rules.exact && this.runLength(px, py, dx, dy, who) !== 5) continue;
                const cells = [];
                for (let k = 0; k < 5; k++) cells.push([px + k * dx, py + k * dy]);
                return { who, cells };
            }
        }
        return null;
    }

    // Số quân liên tiếp cùng màu trên đường qua (x, y) theo hướng (dx, dy), kể cả các quân ngoài cửa sổ năm ô
    runLength(x, y, dx, dy, who) {
        let back = 0, forward = 0;
        while (this.get(x - (back + 1) * dx, y - (back + 1) * dy) === who) back++;
        while (this.get(x + forward * dx, y + forward * dy) === who) forward++;
        return back + forward;
    }

    // Số nước đi theo thứ tự, cho bản xem lại
    static replay(moves, width = DEFAULT_WIDTH, height = DEFAULT_HEIGHT, rules) {
        const board = new Board(width, height, rules);
        for (const { x, y, who } of moves) board.place(x, y, who);
        return board;
    }
}

// Ô trống trong khoảng cách 2 tới một quân nào đó; bàn trống thì chỉ có ô giữa
function nearbyEmpty(board) {
    const cells = [];
    let any = false;
    for (let y = 0; y < board.height; y++) {
        for (let x = 0; x < board.width; x++) {
            if (board.get(x, y) !== EMPTY) any = true;
        }
    }
    if (!any) return [[Math.floor(board.width / 2), Math.floor(board.height / 2)]];
    for (let y = 0; y < board.height; y++) {
        for (let x = 0; x < board.width; x++) {
            if (board.get(x, y) !== EMPTY) continue;
            let near = false;
            for (let dy = -2; dy <= 2 && !near; dy++) {
                for (let dx = -2; dx <= 2 && !near; dx++) near = board.get(x + dx, y + dy) !== EMPTY;
            }
            if (near) cells.push([x, y]);
        }
    }
    return cells;
}

// Giá trị của ô (x, y) nếu bên `who` đánh vào đó: tấn công + phòng thủ (dùng để sắp thứ tự nước đi)
function cellValue(board, x, y, who) {
    const enemy = other(who);
    let attack = 0, defence = 0;
    for (const [dx, dy] of DIRECTIONS) {
        for (let s = -4; s <= 0; s++) {
            let mine = 0, theirs = 0, fits = true;
            for (let k = 0; k < 5 && fits; k++) {
                const px = x + (s + k) * dx, py = y + (s + k) * dy;
                if (!board.inside(px, py)) fits = false;
                else if (s + k !== 0) {
                    const v = board.get(px, py);
                    if (v === who) mine++;
                    else if (v === enemy) theirs++;
                }
            }
            if (!fits) continue;
            if (theirs === 0) attack += SCORE[mine + 1];
            if (mine === 0) defence += SCORE[theirs + 1];
        }
    }
    return attack + DEFENCE_WEIGHT * defence;
}

// Các nước đi đáng xét, tốt nhất trước (có chút ngẫu nhiên để không lặp lại đúng một ván)
function candidates(board, who, limit, jitter = 0.5) {
    const scored = nearbyEmpty(board).map(([x, y]) => ({
        x, y, value: cellValue(board, x, y, who) + Math.random() * jitter
    }));
    scored.sort((a, b) => b.value - a.value);
    return scored.slice(0, limit);
}

// Đánh giá thế cờ cho bên `who`: tổng điểm các cửa sổ năm ô chỉ có quân của một bên
export function evaluate(board, who) {
    const enemy = other(who);
    let total = 0;
    for (const [dx, dy] of DIRECTIONS) {
        for (let y = 0; y < board.height; y++) {
            for (let x = 0; x < board.width; x++) {
                if (!board.inside(x + 4 * dx, y + 4 * dy)) continue;
                let mine = 0, theirs = 0;
                for (let k = 0; k < 5; k++) {
                    const v = board.get(x + k * dx, y + k * dy);
                    if (v === who) mine++;
                    else if (v === enemy) theirs++;
                }
                if (mine && theirs) continue;
                if (mine) total += SCORE[mine];
                else if (theirs) total -= DEFENCE_WEIGHT * SCORE[theirs];
            }
        }
    }
    return total;
}

// Các ô mà bên `who` đánh vào sẽ thắng ngay
export function winningCells(board, who) {
    const wins = [];
    for (const [x, y] of nearbyEmpty(board)) {
        board.place(x, y, who);
        if (board.winAt(x, y)) wins.push([x, y]);
        board.remove(x, y);
    }
    return wins;
}

// Mức "vừa": chấm điểm kiểu EvalueGomokuBoard của bản Unity, cho bên máy `who` (bên đối phương là người)
function unityScores(board, who) {
    const scores = new Float64Array(board.cells.length);
    const human = other(who);
    for (const [dx, dy] of DIRECTIONS) {
        for (let y = 0; y < board.height; y++) {
            for (let x = 0; x < board.width; x++) {
                if (!board.inside(x + 4 * dx, y + 4 * dy)) continue;
                let humans = 0, machines = 0;
                for (let k = 0; k < 5; k++) {
                    const v = board.get(x + k * dx, y + k * dy);
                    if (v === human) humans++;
                    else if (v === who) machines++;
                }
                if (humans * machines !== 0 || humans === machines) continue;
                const before = board.get(x - dx, y - dy), after = board.get(x + 5 * dx, y + 5 * dy);
                for (let k = 0; k < 5; k++) {
                    const cx = x + k * dx, cy = y + k * dy;
                    if (board.get(cx, cy) !== EMPTY) continue;
                    const i = cx + board.width * cy;
                    if (machines === 0) {
                        scores[i] += TSCORE[humans];
                        if (before === who && after === who) scores[i] = 0; // bị chặn hai đầu
                    }
                    if (humans === 0) {
                        scores[i] += KSCORE[machines];
                        if (before === human && after === human) scores[i] = 0;
                    }
                    if ((humans === 4 || machines === 4) && (board.get(cx - dx, cy - dy) === EMPTY || board.get(cx + dx, cy + dy) === EMPTY)) {
                        scores[i] *= 2;
                    }
                }
            }
        }
    }
    return scores;
}

function unityMove(board, who) {
    const scores = unityScores(board, who);
    const top = [];
    for (let i = 0; i < scores.length; i++) if (scores[i] > 0) top.push(i);
    top.sort((a, b) => scores[b] - scores[a]);
    if (!top.length) {
        const [x, y] = nearbyEmpty(board)[0] || [];
        return [x, y];
    }
    // ngẫu nhiên trong 4 nước tốt nhất như bản Unity
    const pick = top[Math.min(top.length - 1, Math.floor(Math.random() * 4))];
    return [pick % board.width, Math.floor(pick / board.width)];
}

// Tìm kiếm alpha-beta (negamax) với giới hạn độ sâu và số nước xét mỗi tầng
function negamax(board, who, depth, alpha, beta, beams, ply) {
    if (depth === 0) return evaluate(board, who);
    const moves = candidates(board, who, beams[Math.min(ply, beams.length - 1)]);
    if (!moves.length) return 0;
    let best = -Infinity;
    for (const { x, y } of moves) {
        board.place(x, y, who);
        let score;
        if (board.winAt(x, y)) score = WIN_SCORE - ply;
        else score = -negamax(board, other(who), depth - 1, -beta, -alpha, beams, ply + 1);
        board.remove(x, y);
        if (score > best) best = score;
        if (best > alpha) alpha = best;
        if (alpha >= beta) break;
    }
    return best;
}

function searchMove(board, who, depth, beams) {
    const wins = winningCells(board, who);
    if (wins.length) return wins[0];
    const blocks = winningCells(board, other(who));
    if (blocks.length === 1) return blocks[0];

    const moves = candidates(board, who, beams[0]);
    let best = moves[0], bestScore = -Infinity;
    for (const { x, y } of moves) {
        board.place(x, y, who);
        const score = board.winAt(x, y) ? WIN_SCORE : -negamax(board, other(who), depth - 1, -Infinity, -bestScore, beams, 1);
        board.remove(x, y);
        if (score > bestScore) {
            bestScore = score;
            best = { x, y };
        }
    }
    return [best.x, best.y];
}

// Nước đi của máy ở mức `level` cho bên `who`; [x, y] hoặc null nếu bàn đầy
export function chooseMove(board, who, level = 'hard') {
    if (board.isFull()) return null;
    if (level === 'easy') {
        const wins = winningCells(board, who);
        if (wins.length) return wins[0];
        const blocks = winningCells(board, other(who));
        if (blocks.length && Math.random() < 0.5) return blocks[0];
        const moves = candidates(board, who, 6, 2);
        const pick = moves[Math.floor(Math.random() * moves.length)];
        return [pick.x, pick.y];
    }
    if (level === 'medium') {
        const wins = winningCells(board, who);
        if (wins.length) return wins[0];
        const blocks = winningCells(board, other(who));
        if (blocks.length) return blocks[0];
        return unityMove(board, who);
    }
    if (level === 'expert') return searchMove(board, who, 4, [10, 8, 6, 4]);
    return searchMove(board, who, 2, [12, 10]);
}
