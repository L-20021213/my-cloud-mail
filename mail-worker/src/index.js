import app from './hono/webs';
import { email } from './email/email';
import userService from './service/user-service';
import verifyRecordService from './service/verify-record-service';
import emailService from './service/email-service';
import kvObjService from './service/kv-obj-service';
import oauthService from './service/oauth-service';
import analysisService from './service/analysis-service';

export default {
    async fetch(req, env, ctx) {
        const url = new URL(req.url);

        // API：保持原有 /api/* 对外地址，内部去掉 /api 前缀后交给 Hono。
        if (url.pathname.startsWith('/api/')) {
            url.pathname = url.pathname.replace(/^\/api/, '') || '/';
            req = new Request(url.toString(), req);
            return app.fetch(req, env, ctx);
        }

        // 当未配置独立 R2/S3 域名时，附件和登录背景等资源仍由 Worker 提供。
        // 前端分离部署时可通过 VITE_ASSET_BASE_URL 指向本 Worker。
        if (['/static/', '/attachments/'].some(p => url.pathname.startsWith(p))) {
            return await kvObjService.toObjResp({ env }, url.pathname.substring(1));
        }

        // 前后端分离：Worker 不再托管 Vue dist。
        return new Response('Cloud Mail API Worker', {
            status: 404,
            headers: {
                'content-type': 'text/plain; charset=UTF-8'
            }
        });
    },

    email: email,

    async scheduled(c, env, ctx) {
        if (c.cron === '*/30 * * * *') {
            await analysisService.refreshEchartsCache({ env });
            return;
        }

        await verifyRecordService.clearRecord({ env });
        await userService.resetDaySendCount({ env });
        await emailService.completeReceiveAll({ env });
        await emailService.autoClean({ env });
        await analysisService.refreshEchartsCache({ env });
        await oauthService.clearNoBindOathUser({ env });
    },
};
