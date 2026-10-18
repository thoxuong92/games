// Chạy trong Discord (Activity): Discord mở trang trong một iframe có frame_id và instance_id.
// instance_id là một kênh: mọi người mở Caro trong cùng kênh dùng chung một phòng.
// Đăng nhập: Embedded App SDK (public/vendor/discord-sdk) lấy mã OAuth (scope identify); máy chủ đổi mã lấy
// thông tin người dùng bằng client secret và cấp phiên. Cần discordClientId trong config.json.

import { adoptPlayer, api, setAuthToken } from './api.js';

const params = new URLSearchParams(location.search);

// Mã kênh của Activity, hoặc '' khi mở ngoài Discord
export const discordInstanceId = params.has('frame_id') ? params.get('instance_id') || '' : '';

export const inDiscord = () => params.has('frame_id');

// Sẵn sàng SDK rồi đăng nhập. Trả về { player } khi thành công, hoặc { error } (chuỗi, gồm bước bị lỗi) để
// giao diện báo cho người chơi. Khi lỗi, chơi như trình duyệt thường với tên tự đặt.
export async function startDiscord() {
    if (!inDiscord()) return {};
    let step = 'đọc cấu hình';
    try {
        const config = await (await fetch('config.json', { cache: 'no-cache' })).json();
        if (!config.discordClientId) return { error: 'chưa có discordClientId trong config.json' };
        step = 'khởi động Discord SDK';
        const { DiscordSDK } = await import('../vendor/discord-sdk/index.mjs');
        const sdk = new DiscordSDK(config.discordClientId);
        await sdk.ready();
        step = 'xin quyền Discord (authorize)';
        const { code } = await sdk.commands.authorize({
            client_id: config.discordClientId,
            response_type: 'code',
            state: '',
            scope: ['identify']
        });
        step = 'máy chủ đổi mã đăng nhập';
        const { token, accessToken, player } = await api('POST', '/api/auth/discord', { code });
        step = 'xác thực với Discord SDK (authenticate)';
        await sdk.commands.authenticate({ access_token: accessToken });
        setAuthToken(token);
        adoptPlayer(player);
        return { player };
    } catch (error) {
        console.warn('Đăng nhập Discord không được:', error);
        return { error: `${step}: ${error?.message || error}` };
    }
}
