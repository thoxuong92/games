// Bàn cờ vẽ bằng canvas: vừa khung, nhận chạm / nhấp chuột, đánh dấu nước vừa đi và đường thắng.
import { CIRCLE, CROSS, EMPTY } from './core.js';

const MIN_CELL = 17;
const COLORS = {
    board: '#18213d',
    grid: 'rgba(148, 163, 255, 0.16)',
    circle: '#fb7185',
    cross: '#38bdf8',
    last: '#fbbf24',
    win: '#fbbf24'
};

export class BoardView {
    constructor(host, { width = 20, height = 15, onTap = null } = {}) {
        this.host = host;
        this.width = width;
        this.height = height;
        this.onTap = onTap;
        this.interactive = false;
        this.hoverWho = CIRCLE;
        this.cells = new Uint8Array(width * height);
        this.last = null;
        this.winLine = null;
        this.hover = null;
        this.marks = [];
        this.cell = MIN_CELL;

        this.canvas = document.createElement('canvas');
        this.canvas.className = 'board';
        this.ctx = this.canvas.getContext('2d');
        this.host.append(this.canvas);

        this.pointerDown = null;
        this.canvas.addEventListener('pointerdown', e => {
            this.pointerDown = { x: e.clientX, y: e.clientY, type: e.pointerType };
        });
        this.canvas.addEventListener('pointerup', e => {
            const down = this.pointerDown;
            this.pointerDown = null;
            if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 8) return;
            const cell = this.cellAt(e);
            if (cell && this.interactive && this.onTap) this.onTap(cell.x, cell.y);
        });
        this.canvas.addEventListener('pointermove', e => {
            if (e.pointerType !== 'mouse') return;
            const cell = this.cellAt(e);
            const next = cell && this.interactive && this.cells[cell.x + this.width * cell.y] === EMPTY ? cell : null;
            if (!sameCell(next, this.hover)) {
                this.hover = next;
                this.draw();
            }
        });
        this.canvas.addEventListener('pointerleave', () => {
            if (this.hover) {
                this.hover = null;
                this.draw();
            }
        });

        this.observer = new ResizeObserver(() => this.resize());
        this.observer.observe(this.host);
        this.resize();
    }

    // Đặt lại toàn bộ bàn từ danh sách nước đi: [{x, y, who}]
    setMoves(moves, { winLine = null } = {}) {
        this.cells.fill(EMPTY);
        for (const { x, y, who } of moves) this.cells[x + this.width * y] = who;
        this.last = moves.length ? moves[moves.length - 1] : null;
        this.winLine = winLine;
        this.draw();
    }

    // Đánh dấu các ô bằng khung nét đứt (dùng trong hình minh hoạ): [{x, y}]
    setMarks(marks) {
        this.marks = marks;
        this.draw();
    }

    setInteractive(on, who = this.hoverWho) {
        this.interactive = on;
        this.hoverWho = who;
        if (!on && this.hover) this.hover = null;
        this.canvas.style.cursor = on ? 'pointer' : 'default';
        this.draw();
    }

    cellAt(e) {
        const rect = this.canvas.getBoundingClientRect();
        const x = Math.floor((e.clientX - rect.left) / this.cell);
        const y = Math.floor((e.clientY - rect.top) / this.cell);
        if (x < 0 || y < 0 || x >= this.width || y >= this.height) return null;
        return { x, y };
    }

    resize() {
        const available = this.host.clientWidth;
        if (!available) return;
        const cell = Math.max(MIN_CELL, Math.floor(available / this.width));
        const dpr = window.devicePixelRatio || 1;
        this.cell = cell;
        this.canvas.style.width = `${cell * this.width}px`;
        this.canvas.style.height = `${cell * this.height}px`;
        this.canvas.width = Math.round(cell * this.width * dpr);
        this.canvas.height = Math.round(cell * this.height * dpr);
        this.dpr = dpr;
        this.draw();
    }

    draw() {
        const { ctx, cell, width, height } = this;
        const dpr = this.dpr || 1;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        const w = cell * width, h = cell * height;
        ctx.clearRect(0, 0, w, h);
        ctx.fillStyle = COLORS.board;
        ctx.fillRect(0, 0, w, h);

        ctx.strokeStyle = COLORS.grid;
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (let x = 0; x <= width; x++) {
            ctx.moveTo(x * cell + 0.5, 0);
            ctx.lineTo(x * cell + 0.5, h);
        }
        for (let y = 0; y <= height; y++) {
            ctx.moveTo(0, y * cell + 0.5);
            ctx.lineTo(w, y * cell + 0.5);
        }
        ctx.stroke();

        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const who = this.cells[x + width * y];
                if (who !== EMPTY) this.drawStone(x, y, who, 1);
            }
        }
        if (this.hover) this.drawStone(this.hover.x, this.hover.y, this.hoverWho, 0.35);

        if (this.last && !this.winLine) {
            const { x, y } = this.last;
            ctx.strokeStyle = COLORS.last;
            ctx.lineWidth = Math.max(1.5, cell * 0.07);
            ctx.beginPath();
            ctx.arc(center(x, cell), center(y, cell), cell * 0.44, 0, Math.PI * 2);
            ctx.stroke();
        }

        for (const { x, y } of this.marks) {
            const pad = cell * 0.08;
            ctx.save();
            ctx.setLineDash([cell * 0.15, cell * 0.1]);
            ctx.strokeStyle = COLORS.last;
            ctx.lineWidth = Math.max(1.5, cell * 0.06);
            ctx.strokeRect(x * cell + pad, y * cell + pad, cell - 2 * pad, cell - 2 * pad);
            ctx.restore();
        }

        if (this.winLine?.length) {
            const [[ax, ay], [bx, by]] = [this.winLine[0], this.winLine[this.winLine.length - 1]];
            ctx.save();
            ctx.strokeStyle = COLORS.win;
            ctx.lineCap = 'round';
            ctx.lineWidth = cell * 0.16;
            ctx.shadowColor = COLORS.win;
            ctx.shadowBlur = cell * 0.6;
            ctx.beginPath();
            ctx.moveTo(center(ax, cell), center(ay, cell));
            ctx.lineTo(center(bx, cell), center(by, cell));
            ctx.stroke();
            ctx.restore();
        }
    }

    drawStone(x, y, who, alpha) {
        const { ctx, cell } = this;
        const cx = center(x, cell), cy = center(y, cell);
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.lineCap = 'round';
        if (who === CIRCLE) {
            ctx.strokeStyle = COLORS.circle;
            ctx.lineWidth = Math.max(2, cell * 0.12);
            ctx.beginPath();
            ctx.arc(cx, cy, cell * 0.32, 0, Math.PI * 2);
            ctx.stroke();
        } else if (who === CROSS) {
            const r = cell * 0.28;
            ctx.strokeStyle = COLORS.cross;
            ctx.lineWidth = Math.max(2, cell * 0.12);
            ctx.beginPath();
            ctx.moveTo(cx - r, cy - r);
            ctx.lineTo(cx + r, cy + r);
            ctx.moveTo(cx + r, cy - r);
            ctx.lineTo(cx - r, cy + r);
            ctx.stroke();
        }
        ctx.restore();
    }

    destroy() {
        this.observer.disconnect();
        this.canvas.remove();
    }
}

function center(index, cell) {
    return (index + 0.5) * cell;
}

function sameCell(a, b) {
    return a === b || (a && b && a.x === b.x && a.y === b.y);
}
