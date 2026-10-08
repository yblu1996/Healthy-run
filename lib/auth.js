const jwt = require('jsonwebtoken');

// JWT 是签名而非加密，base64 可被任何人解出 payload。
// 因此 payload 只放 user_id，绝不放手机号等隐私信息（隐私字段一律走 /api/auth/me 按需获取）。
// 没有密钥还继续运行 = 任何人可伪造任意用户 token，宁可拒绝启动也不能带病上线
const SECRET = process.env.JWT_SECRET;
if (!SECRET || SECRET.length < 32) {
  console.error('[启动失败] 未设置 JWT_SECRET 或长度不足 32 位。请在 .env 里配置一串长随机字符，例如执行：');
  console.error('  node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"');
  process.exit(1);
}

// 7 天有效期：兼顾"不用天天登录"与"凭证泄露后风险可控"。
// 用户不希望"点开链接就自动进"的话，把 7d 改成 1d 或 2h 即可（改完重启服务）
const TOKEN_TTL = process.env.JWT_TTL || '7d';

function signToken(user) {
  return jwt.sign({ id: user.id }, SECRET, { expiresIn: TOKEN_TTL });
}

function verifyToken(token) {
  return jwt.verify(token, SECRET);
}

module.exports = { signToken, verifyToken };
