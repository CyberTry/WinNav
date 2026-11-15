'use strict';

const { E } = require('./errors');

/**
 * 归一化访问地址：
 * - 无协议时补全 http://
 * - 仅允许 http / https
 * - 返回 URL.href（示例：http://192.168.1.20:8096/）
 */
function normalizeUrl(raw) {
  if (typeof raw !== 'string') throw E.invalid('访问地址必须是字符串');
  let value = raw.trim();
  if (!value) throw E.invalid('请填写访问地址');
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) value = 'http://' + value;

  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw E.invalid('访问地址无法解析，请检查 IP / 域名与端口');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw E.invalid('仅支持 http 与 https 协议');
  }
  if (!parsed.hostname) throw E.invalid('访问地址缺少主机名');
  return parsed.href;
}

/** 拆出探测需要的字段 */
function parseTarget(url) {
  const parsed = new URL(url);
  const scheme = parsed.protocol.replace(':', '');
  const port = parsed.port ? Number.parseInt(parsed.port, 10) : (scheme === 'https' ? 443 : 80);
  return {
    scheme,
    host: parsed.hostname.replace(/^\[|\]$/g, ''),
    port,
    path: (parsed.pathname || '/') + (parsed.search || ''),
    hostHeader: parsed.host,
    href: parsed.href
  };
}

/** 展示用地址：去掉协议与结尾斜杠 */
function displayUrl(url) {
  return String(url).replace(/^https?:\/\//i, '').replace(/\/+$/, '');
}

module.exports = { normalizeUrl, parseTarget, displayUrl };
