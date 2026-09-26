import KvConst from '../const/kv-const';

const WECOM_API_BASE = 'https://qyapi.weixin.qq.com/cgi-bin';

// 企业微信应用消息推送：text 消息 content 上限 2048 字节，预留余量按 1800 截断
const WECOM_APP_TEXT_BYTE_LIMIT = 1800;

// 按 UTF-8 字节数截断，避免超出企业微信消息长度限制
function truncateByBytes(str, maxBytes) {
	if (!str) return '';
	const encoder = new TextEncoder();
	let out = '';
	let bytes = 0;
	for (const ch of str) {
		const b = encoder.encode(ch).length;
		if (bytes + b > maxBytes) break;
		out += ch;
		bytes += b;
	}
	return out;
}

// 构造应用消息纯文本内容
function buildAppText(emailRow) {
	const name = emailRow.name || '';
	const sendEmail = emailRow.sendEmail || '';
	const toEmail = emailRow.toEmail || '';
	const subject = emailRow.subject || '';
	const code = emailRow.code || '';
	const text = emailRow.text ? emailRow.text.replace(/\s+/g, ' ').trim() : '';

	const lines = [];
	lines.push(`📧 新邮件提醒`);
	if (sendEmail) {
		lines.push(`发件人：${name ? `${name} ` : ''}<${sendEmail}>`);
	}
	if (toEmail) {
		lines.push(`收件人：${toEmail}`);
	}
	lines.push(`主题：${subject || '(无主题)'}`);
	if (code) {
		lines.push(`验证码：${code}`);
	}
	if (text) {
		lines.push(`正文：${text}`);
	}

	return truncateByBytes(lines.join('\n'), WECOM_APP_TEXT_BYTE_LIMIT);
}

const wecomAppService = {

	// 解析配置：优先 WECOM_CORP_ID+WECOM_APP_SECRET+WECOM_AGENT_ID 三个独立变量，
	// 其次支持 WECOM_APP_PUSH 单变量（格式：企业ID#Secret#AgentID）
	parseConfig(c) {
		const env = c.env || {};

		if (env.WECOM_CORP_ID && env.WECOM_APP_SECRET && env.WECOM_AGENT_ID) {
			return {
				corpId: String(env.WECOM_CORP_ID).trim(),
				secret: String(env.WECOM_APP_SECRET).trim(),
				agentId: String(env.WECOM_AGENT_ID).trim()
			};
		}

		const push = env.WECOM_APP_PUSH || '';
		const parts = push.split('#');
		if (parts.length >= 3 && parts[0] && parts[1] && parts[2]) {
			return {
				corpId: parts[0].trim(),
				secret: parts[1].trim(),
				agentId: parts[2].trim()
			};
		}

		return null;
	},

	// 获取 access_token（KV 缓存，有效期 7200s，提前 5 分钟过期刷新）
	async getAccessToken(c, config) {
		const kvKey = KvConst.WECOM_TOKEN || 'wecom_token:';

		const cached = await c.env.kv.get(kvKey, { type: 'json' });
		if (cached && cached.token && cached.expireAt > Date.now() + 300000) {
			return cached.token;
		}

		const url = `${WECOM_API_BASE}/gettoken?corpid=${encodeURIComponent(config.corpId)}&corpsecret=${encodeURIComponent(config.secret)}`;

		const res = await fetch(url);
		const data = await res.json();

		if (data.errcode !== 0) {
			throw new Error(`获取 access_token 失败: errcode=${data.errcode} errmsg=${data.errmsg}`);
		}

		const expireIn = Number(data.expires_in || 7200) * 1000;
		await c.env.kv.put(kvKey, JSON.stringify({
			token: data.access_token,
			expireAt: Date.now() + expireIn
		}));

		return data.access_token;
	},

	// 发送应用消息到企业微信
	async sendEmailToApp(c, emailRow) {

		const config = this.parseConfig(c);
		if (!config) {
			console.error('企业微信应用推送未配置：请设置 WECOM_APP_PUSH（企业ID#Secret#AgentID）或 WECOM_CORP_ID + WECOM_APP_SECRET + WECOM_AGENT_ID');
			return;
		}

		// 未开启时跳过（WECOM_APP_SWITCH=0 表示关闭）
		if (c.env.WECOM_APP_SWITCH === '0' || c.env.WECOM_APP_SWITCH === 0) {
			return;
		}

		try {
			const accessToken = await this.getAccessToken(c, config);

			// 接收人：默认 @all 全员，可用 WECOM_TO_USER 指定成员 UserID（多个用 | 分隔）
			const touser = c.env.WECOM_TO_USER || '@all';

			const body = JSON.stringify({
				touser,
				msgtype: 'text',
				agentid: Number(config.agentId),
				text: {
					content: buildAppText(emailRow)
				},
				safe: 0
			});

			const res = await fetch(`${WECOM_API_BASE}/message/send?access_token=${accessToken}`, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json'
				},
				body
			});

			const data = await res.json();

			// errcode 0 表示成功；invalid token 时清除缓存以便下次重新获取
			if (data.errcode !== 0) {
				if (data.errcode === 40014 || data.errcode === 42001) {
					await c.env.kv.delete(KvConst.WECOM_TOKEN || 'wecom_token:');
				}
				console.error(`企业微信应用推送失败: errcode=${data.errcode} errmsg=${data.errmsg}`);
			}

		} catch (e) {
			console.error('企业微信应用推送异常:', e.message);
		}
	}
};

export default wecomAppService;
