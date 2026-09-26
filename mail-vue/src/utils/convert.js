import {useSettingStore} from "@/store/setting.js";
export function cvtR2Url(key) {

    if (!key) {
        return + 'https://' + ''
    }

    if (key.startsWith('https://')) {
        return key
    }

    const { settings } = useSettingStore();

    let domain = settings.r2Domain

    if (!domain) {
        // 前后端分离部署时，未配置独立 R2/S3 域名的资源由 Cloudflare Worker 提供。
        // 通过 VITE_ASSET_BASE_URL 避免资源请求落到 Vercel 前端域名。
        const assetBase = import.meta.env.VITE_ASSET_BASE_URL
        if (assetBase) {
            return assetBase.replace(/\/$/, '') + '/' + key.replace(/^\//, '')
        }
        return key;
    }

    if (!domain.startsWith('http')) {
        return 'https://' + domain + '/' + key
    }

    if (domain.endsWith("/")) {
        domain = domain.slice(0, -1);
    }
    return domain + '/' + key
}

export function toOssDomain(domain) {

    if (!domain) {
        return ''
    }

    if (!domain.startsWith('http')) {
        return 'https://' + domain
    }

    if (domain.endsWith("/")) {
        domain = domain.slice(0, -1);
    }

    return domain
}
