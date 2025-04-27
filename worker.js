// KV 命名空间绑定名称
const ADMIN_USERNAME = 'admin' // 在实际部署时更改
const ADMIN_PASSWORD = 'admin123' // 在实际部署时更改

// 生成8位随机字符串
function generateShortCode() {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < 8; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

// 验证管理员身份
function isAdmin(request) {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader || !authHeader.startsWith('Basic ')) {
    return false;
  }

  const [username, password] = atob(authHeader.slice(6)).split(':');
  return username === ADMIN_USERNAME && password === ADMIN_PASSWORD;
}

// 处理 API 请求
async function handleAPI(request) {
  const url = new URL(request.url);
  const path = url.pathname.slice(5); // 移除开头的 /api/

  // 验证管理员身份
  if (!isAdmin(request)) {
    return new Response('Unauthorized', { status: 401, headers: { 'Content-Type': 'application/json' } });
  }

  if (path === 'accounts') {
    if (request.method === 'GET') {
      const accounts = await listAccounts();
      return new Response(JSON.stringify(accounts), {
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    if (request.method === 'POST') {
      const { username, shortCode } = await request.json();
      
      // 验证用户名格式
      if (!username || typeof username !== 'string') {
        return new Response('Instagram用户名是必填项', { status: 400 });
      }

      // 如果提供了短代码，则验证格式
      if (shortCode && typeof shortCode !== 'string') {
        return new Response('短代码格式不正确', { status: 400 });
      }
      
      // 如果提供了短代码，检查是否已存在
      if (shortCode) {
        const existingShortCode = await INSTAGRAM_ACCOUNTS.get(`shortcode:${shortCode}`, 'json');
        if (existingShortCode) {
          return new Response('短代码已存在', { status: 400 });
        }
      }

      // 创建新账号
      const account = {
        username,
        shortCode: shortCode || null, // 如果没有提供短代码，则设为null
        clicks: 0,
        lastUsed: null,
        hasCustomShortCode: !!shortCode, // 标记是否有自定义短代码
        createdAt: new Date().toISOString() // 添加创建时间
      };

      // 保存账号信息
      await INSTAGRAM_ACCOUNTS.put(username, JSON.stringify(account));
      
      // 如果有短代码，也保存短代码映射
      if (shortCode) {
        await INSTAGRAM_ACCOUNTS.put(`shortcode:${shortCode}`, JSON.stringify(account));
      }

      return new Response(JSON.stringify(account), {
        headers: { 'Content-Type': 'application/json' }
      });
    }
  }

  if (path.startsWith('accounts/')) {
    const username = path.slice(9); // 移除 accounts/
    
    if (request.method === 'DELETE') {
      const account = await INSTAGRAM_ACCOUNTS.get(username, 'json');
      if (account) {
        await INSTAGRAM_ACCOUNTS.delete(username);
        if (account.shortCode) {
          await INSTAGRAM_ACCOUNTS.delete(`shortcode:${account.shortCode}`);
        }
        return new Response('OK');
      }
      return new Response('Account not found', { status: 404 });
    }
  }

  if (path === 'stats/reset' && request.method === 'POST') {
    try {
      const accounts = await listAccounts();
      for (const account of accounts) {
        account.clicks = 0;
        account.lastUsed = null;
        await updateAccount(account);
      }
      return new Response(JSON.stringify({success: true}), {
        headers: { 'Content-Type': 'application/json' }
      });
    } catch (error) {
      console.error('Error resetting stats:', error);
      return new Response(JSON.stringify({error: error.message}), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }
  }

  return new Response('Not Found', { status: 404 });
}

// 全局变量，用于记录上次轮询的账号索引
let lastRotationIndex = -1;

// 处理请求的主函数
async function handleRequest(request) {
  const url = new URL(request.url);
  const path = url.pathname.slice(1); // 移除开头的 /
  const origin = url.origin; // 获取当前请求的origin

  // 处理管理界面
  if (path === 'admin') {
    // 强制要求验证
    if (!isAdmin(request)) {
      return new Response('Unauthorized', {
        status: 401,
        headers: {
          'WWW-Authenticate': 'Basic realm="Instagram账号管理系统"'
        }
      });
    }
    // 替换模板中的变量
    const html = adminHtml.replace(/__ORIGIN__/g, origin);
    return new Response(html, {
      headers: { 'Content-Type': 'text/html' }
    });
  }

  // 处理 API 请求
  if (path.startsWith('api/')) {
    return handleAPI(request);
  }

  // 如果路径为空，按顺序轮询没有设置短链接的账号
  if (path === '') {
    const accounts = await listAccounts();
    if (accounts.length === 0) {
      return new Response('No accounts available', { status: 404 });
    }

    // 筛选没有自定义短代码的账号用于轮询
    const rotationAccounts = accounts.filter(account => !account.hasCustomShortCode);
    
    if (rotationAccounts.length === 0) {
      return new Response('No accounts available for rotation', { status: 404 });
    }
    
    // 按顺序选择下一个账号
    lastRotationIndex = (lastRotationIndex + 1) % rotationAccounts.length;
    const selectedAccount = rotationAccounts[lastRotationIndex];
    
    // 更新点击次数和最后使用时间
    selectedAccount.clicks++;
    selectedAccount.lastUsed = new Date().toISOString();
    await updateAccount(selectedAccount);

    return Response.redirect(`https://instagram.com/${selectedAccount.username}`, 302);
  }

  // 处理短代码重定向
  const account = await INSTAGRAM_ACCOUNTS.get(`shortcode:${path}`, 'json');
  if (account) {
    // 更新点击次数和最后使用时间
    account.clicks++;
    account.lastUsed = new Date().toISOString();
    await updateAccount(account);

    return Response.redirect(`https://instagram.com/${account.username}`, 302);
  }

  // 返回 404 页面
  return new Response(notFoundHtml, {
    status: 404,
    headers: { 'Content-Type': 'text/html' }
  });
}

// 管理界面 HTML
const adminHtml = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Instagram 账号管理</title>
  <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.1.3/dist/css/bootstrap.min.css" rel="stylesheet">
  <style>
    .btn-primary {
      background-color: #0d6efd;
      border-color: #0d6efd;
    }
    .btn-warning {
      background-color: #ffc107;
      border-color: #ffc107;
    }
    .note {
      color: red;
      font-size: 12px;
      margin-top: 5px;
    }
  </style>
</head>
<body>
  <div class="container mt-5">
    <h1 class="mb-4">Instagram 账号管理</h1>
    <div class="note mb-3">注意: 不管是自定义链接还是轮询链接，都要进行INSTAGRAM APP跳转(因为INSTAGRAM本身 账号在浏览器中打开链接是没有跳转APP的)</div>
    
    <div class="card mb-4">
      <div class="card-body">
        <h5 class="card-title">添加新账号</h5>
        <form id="addForm">
          <div class="row g-3">
            <div class="col-md-6">
              <label class="form-label">Instagram 用户名</label>
              <input type="text" class="form-control" id="username" required>
              <div class="note">这里指的是INSTAGRAM账号</div>
            </div>
            <div class="col-md-6">
              <label class="form-label">自定义短代码 (8位)</label>
              <input type="text" class="form-control" id="shortCode">
              <div class="note">这里是域名/后面添加的8个字符</div>
              <div class="form-text">这将作为访问链接的一部分，例如: __ORIGIN__/你的短代码。如不填写则只能通过轮询访问。</div>
            </div>
          </div>
          <button type="submit" class="btn btn-primary mt-3">添加账号</button>
        </form>
      </div>
    </div>

    <div class="card mb-4">
      <div class="card-body">
        <h5 class="card-title">轮询地址</h5>
        <div class="input-group">
          <input type="text" class="form-control" id="rotateUrl" value="__ORIGIN__" readonly>
          <button class="btn btn-outline-secondary" onclick="copyToClipboard('rotateUrl')">复制</button>
        </div>
        <small class="text-muted">访问此地址将自动轮询所有账号</small>
        <div class="note">这是只轮询没有设置短链接的账号(按外部请求顺序)</div>
      </div>
    </div>

    <div class="card">
      <div class="card-body">
        <div class="d-flex justify-content-between align-items-center mb-3">
          <h5 class="card-title mb-0">账号列表</h5>
          <button onclick="resetStats()" class="btn btn-warning">重置统计</button>
        </div>
        <div class="note mb-3">如果重置统计，将会把所有账号的[点击次数]、[开始使用时间]、[最后使用时间]清0</div>
        <div class="table-responsive">
          <table class="table">
            <thead>
              <tr>
                <th>用户名</th>
                <th>短链接</th>
                <th>自定义链接</th>
                <th>点击次数</th>
                <th>开始使用时间</th>
                <th>最后使用时间</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody id="accountsList"></tbody>
          </table>
        </div>
      </div>
    </div>
  </div>

  <script>
    // 复制到剪贴板
    function copyToClipboard(elementId) {
      const element = document.getElementById(elementId);
      element.select();
      document.execCommand('copy');
    }

    // 加载账号列表
    async function loadAccounts() {
      try {
        const response = await fetch('/api/accounts', {
          headers: {
            'Authorization': 'Basic ' + btoa('admin:admin123')
          }
        });
        
        if (!response.ok) {
          throw new Error('Failed to load accounts');
        }
        
        const accounts = await response.json();
        const tbody = document.getElementById('accountsList');
        tbody.innerHTML = '';
        
        // 使用当前页面的origin作为基础URL
        const baseUrl = location.origin;
        
        accounts.forEach(account => {
          const tr = document.createElement('tr');
          
          // 短链接显示
          let shortLinkHtml = '';
          if (account.shortCode) {
            const shortCodeId = 'shortcode_' + account.shortCode;
            const accountUrl = baseUrl + '/' + account.shortCode;
            shortLinkHtml = \`
              <div class="input-group">
                <input type="text" class="form-control" id="\${shortCodeId}" value="\${accountUrl}" readonly>
                <button class="btn btn-outline-secondary" onclick="copyToClipboard('\${shortCodeId}')">复制</button>
              </div>
            \`;
          } else {
            shortLinkHtml = '<span class="text-muted">未设置</span>';
          }
          
          const createdAtText = account.createdAt ? new Date(account.createdAt).toLocaleString() : '未知';
          const lastUsedText = account.lastUsed ? new Date(account.lastUsed).toLocaleString() : '从未使用';
          
          tr.innerHTML = \`
            <td>\${account.username}</td>
            <td>\${shortLinkHtml}</td>
            <td>\${account.shortCode || '未设置'}</td>
            <td>\${account.clicks || 0}</td>
            <td>\${createdAtText}</td>
            <td>\${lastUsedText}</td>
            <td>
              <button onclick="deleteAccount('\${account.username}')" class="btn btn-sm btn-danger">删除</button>
            </td>
          \`;
          
          tbody.appendChild(tr);
        });
      } catch (error) {
        console.error('加载账号列表失败:', error);
        alert('加载账号列表失败');
      }
    }

    // 添加账号
    document.getElementById('addForm').onsubmit = async (e) => {
      e.preventDefault();
      
      const username = document.getElementById('username').value;
      const shortCode = document.getElementById('shortCode').value || null; // 如果为空，则传null
      
      try {
        const response = await fetch('/api/accounts', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Basic ' + btoa('admin:admin123')
          },
          body: JSON.stringify({
            username,
            shortCode
          })
        });

        if (!response.ok) {
          const error = await response.text();
          alert('添加失败: ' + error);
          return;
        }

        // 清空输入框
        document.getElementById('username').value = '';
        document.getElementById('shortCode').value = '';
        
        // 重新加载账号列表
        loadAccounts();
      } catch (error) {
        alert('添加失败: ' + error.message);
      }
    };

    // 删除账号
    async function deleteAccount(username) {
      if (!confirm('确定要删除这个账号吗？删除后将无法恢复！')) return;
      
      try {
        const response = await fetch('/api/accounts/' + username, {
          method: 'DELETE',
          headers: {
            'Authorization': 'Basic ' + btoa('admin:admin123')
          }
        });

        if (!response.ok) {
          alert('删除失败');
          return;
        }

        loadAccounts();
      } catch (error) {
        alert('删除失败: ' + error.message);
      }
    }

    // 重置统计
    async function resetStats() {
      if (!confirm('确定要重置所有统计数据吗？这将清空所有账号的点击次数和使用时间记录。')) return;
      
      try {
        const response = await fetch('/api/stats/reset', {
          method: 'POST',
          headers: {
            'Authorization': 'Basic ' + btoa('admin:admin123')
          }
        });

        if (!response.ok) {
          const errorText = await response.text();
          console.error('重置失败:', errorText);
          alert('重置失败: ' + errorText);
          return;
        }

        alert('重置统计成功！');
        loadAccounts();
      } catch (error) {
        console.error('重置失败:', error);
        alert('重置失败: ' + error.message);
      }
    }

    // 页面加载完成后加载账号列表
    document.addEventListener('DOMContentLoaded', function() {
      // 加载账号列表
      loadAccounts();
    });
  </script>
</body>
</html>
`;

// 404 页面 HTML
const notFoundHtml = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>404 - 页面未找到</title>
  <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.1.3/dist/css/bootstrap.min.css" rel="stylesheet">
</head>
<body>
  <div class="container mt-5 text-center">
    <h1>404</h1>
    <p>页面未找到</p>
    <a href="/" class="btn btn-primary">返回首页</a>
  </div>
</body>
</html>
`;

// KV 操作函数
async function listAccounts() {
  try {
    const list = await INSTAGRAM_ACCOUNTS.list();
    const accounts = [];
    
    for (const key of list.keys) {
      // 只处理非shortcode:前缀的键
      if (!key.name.startsWith('shortcode:')) {
        const account = await INSTAGRAM_ACCOUNTS.get(key.name, 'json');
        if (account) {
          accounts.push(account);
        }
      }
    }
    return accounts;
  } catch (error) {
    console.error('Error listing accounts:', error);
    return [];
  }
}

async function updateAccount(account) {
  try {
    await INSTAGRAM_ACCOUNTS.put(account.username, JSON.stringify(account));
    if (account.shortCode) {
      await INSTAGRAM_ACCOUNTS.put(`shortcode:${account.shortCode}`, JSON.stringify(account));
    }
  } catch (error) {
    console.error('Error updating account:', error);
  }
}

// 监听请求事件
addEventListener('fetch', event => {
  try {
    event.respondWith(handleRequest(event.request));
  } catch (e) {
    event.respondWith(new Response('Error: ' + e.message, { 
      status: 500,
      headers: { 'Content-Type': 'text/plain' }
    }));
  }
});
