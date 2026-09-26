import domainUtils from '../utils/domain-uitls';

const WECOM_HOST = 'qyapi.weixin.qq.com';
const WECOM_PATH = '/cgi-bin/webhook/send';

// 企业微信 text content 上限 2048 字节，预留余量按 1800 截断
const WECOM_TEXT_BYTE_LIMIT = 1800;

const webhookService = {

	// 判断是否为企微群机器人 webhook
	isWecomUrl(url) {
		if (!url) return false;
		try {
			const u = new URL(url);
			return u.hostname === WECOM_HOST && u.pathname.startsWith(WECOM_PATH);
		} catch (e) {
			return false;
		}
	},

	// 企微 key 中若含 #，必须编码为 %23，否则会被 URL 解析当作 fragment 丢弃，导致 key 不完整（errcode 93000）
	normalizeWecomUrl(url) {
		return url.replace(/#/g, '%23');
	},

	// 按 UTF-8 字节数截断，避免超出企微消息长度限制
	truncateByBytes(str, maxBytes) {
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
	},

	// 构造企微 text 消息体
	buildWecomPayload(emailRow) {
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

		const content = this.truncateByBytes(lines.join('\n'), WECOM_TEXT_BYTE_LIMIT);

		return {
			msgtype: 'text',
			text: { content }
		};
	},

	async sendEmail(c, emailRow, webhookUrl, retry = 0, webhookSecret) {

		webhookUrl = domainUtils.toOssDomain(webhookUrl);

		if (!webhookUrl) {
			return;
		}

		// 企业微信机器人 webhook：自动转换消息格式
		if (this.isWecomUrl(webhookUrl)) {
			await this.sendWecom(c, emailRow, this.normalizeWecomUrl(webhookUrl), retry);
			return;
		}

		// 通用 webhook：保持原有自定义 JSON 格式
		retry = Number(retry);
		if (isNaN(retry) || retry < 0) {
			retry = 0;
		}

		const headers = {
			'Content-Type': 'application/json'
		};

		if (webhookSecret) {
			headers['Authorization'] = webhookSecret;
		}

		const body = JSON.stringify({
			emailId: emailRow.emailId,
			sendEmail: emailRow.sendEmail,
			sendName: emailRow.name,
			toEmail: emailRow.toEmail,
			toName: emailRow.toName,
			subject: emailRow.subject,
			text: emailRow.text,
			content: emailRow.content,
			code: emailRow.code,
			createTime: emailRow.createTime
		});

		let lastError = '';

		for (let i = 0; i <= retry; i++) {
			try {
				const res = await fetch(webhookUrl, {
					method: 'POST',
					headers,
					body
				});

				if (res.ok) {
					return;
				}

				lastError = `status: ${res.status} response: ${await res.text()}`;
			} catch (e) {
				lastError = e.message;
			}
		}

		console.error(`Webhook 推送失败: ${lastError}`);
	},

	// 企业微信专用推送
	async sendWecom(c, emailRow, wecomUrl, retry = 0) {

		retry = Number(retry);
		if (isNaN(retry) || retry < 0) {
			retry = 0;
		}

		const payload = this.buildWecomPayload(emailRow);
		const body = JSON.stringify(payload);

		let lastError = '';

		for (let i = 0; i <= retry; i++) {
			try {
				const res = await fetch(wecomUrl, {
					method: 'POST',
					headers: {
						'Content-Type': 'application/json'
					},
					body
				});

				const text = await res.text();

				// 企微成功返回 {"errcode":0,"errmsg":"ok"}
				if (res.ok && text.includes('"errcode":0')) {
					return;
				}

				lastError = `status: ${res.status} response: ${text}`;
			} catch (e) {
				lastError = e.message;
			}
		}

		console.error(`企业微信推送失败: ${lastError}`);
	}

};

export default webhookService;
