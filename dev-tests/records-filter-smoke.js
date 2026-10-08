// 本地路由冒烟测试：不连接数据库，仅验证记录筛选参数的校验。
process.env.VERCEL = '1';
const assert = require('node:assert/strict');
const app = require('../api/index');
const { signToken } = require('../lib/auth');

(async () => {
  const server = app.listen(0, '127.0.0.1');
  try {
    await new Promise((resolve) => server.once('listening', resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    const health = await fetch(base + '/api/health');
    assert.equal(health.status, 200);
    const token = signToken({ id: 'local-smoke-user' });
    const bad = await fetch(base + '/api/records?status=unexpected', { headers: { Authorization: `Bearer ${token}` } });
    assert.equal(bad.status, 400);
    assert.match((await bad.json()).error, /状态/);
    console.log('PASS 本地路由回归：健康检查、记录状态参数校验');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
})().catch((e) => { console.error(e); process.exitCode = 1; });
