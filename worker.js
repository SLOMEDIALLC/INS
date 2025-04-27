// KV 命名空间绑定名称
const KV_NAMESPACE = 'INSTAGRAM_ACCOUNTS'
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
async function isAdmin(request) {
  const auth = request.headers.get('Authorization')
  if (!auth || !auth.startsWith('Basic ')) {
    return false
  }
  
  const [user, pass] = atob(auth.split(' ')[1]).split(':')
  return user === ADMIN_USERNAME && pass === ADMIN_PASSWORD
}

// 处理 API 请求
async function handleAPI(request) {
  const url = new URL(request.url);
  const path = url.pathname.slice(5); // 移除开头的 /api/

  // 验证管理员身份
  if (!isAdmin(request)) {
    return new Response('Unauthorized', { status: 401 });
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
        return new Response('Invalid username', { status: 400 });
      }

      // 验证短代码格式
      if (!shortCode || typeof shortCode !== 'string') {
        return new Response('Short code is required', { status: 400 });
      }

      // 检查用户名是否已存在
      const existingAccount = await INSTAGRAM_ACCOUNTS.get(username, 'json');
      if (existingAccount) {
        return new Response('Username already exists', { status: 400 });
      }

      // 检查短代码是否已存在
      const existingShortCode = await INSTAGRAM_ACCOUNTS.get(`shortcode:${shortCode}`, 'json');
      if (existingShortCode) {
        return new Response('Short code already exists', { status: 400 });
      }

      // 创建新账号
      const account = {
        username,
        shortCode,
        clicks: 0,
        lastUsed: null
      };

      // 保存账号信息
      await INSTAGRAM_ACCOUNTS.put(username, JSON.stringify(account));
      await INSTAGRAM_ACCOUNTS.put(`shortcode:${shortCode}`, JSON.stringify(account));

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
        await INSTAGRAM_ACCOUNTS.delete(`shortcode:${account.shortCode}`);
        return new Response('OK');
      }
      return new Response('Account not found', { status: 404 });
    }
  }

  if (path === 'stats/reset' && request.method === 'POST') {
    const accounts = await listAccounts();
    for (const account of accounts) {
      account.clicks = 0;
      account.lastUsed = null;
      await updateAccount(account);
    }
    return new Response('OK');
  }

  return new Response('Not Found', { status: 404 });
}

// 处理请求的主函数
async function handleRequest(request) {
  const url = new URL(request.url)
  const path = url.pathname.slice(1) // 移除开头的 /
  
  // 处理管理后台路由
  if (path === 'admin') {
    return handleAdmin(request)
  }
  
  // 处理 API 请求
  if (path.startsWith('api/')) {
    return handleAPI(request)
  }

  // 如果路径为空，随机选择一个账号进行重定向
  if (path === '') {
    const accounts = await listAccounts();
    if (accounts.length === 0) {
      return new Response('No accounts available', { status: 404 });
    }

    // 随机选择一个账号
    const randomAccount = accounts[Math.floor(Math.random() * accounts.length)];
    
    // 更新点击次数和最后使用时间
    randomAccount.clicks++;
    randomAccount.lastUsed = new Date().toISOString();
    await updateAccount(randomAccount);

    return Response.redirect(`https://instagram.com/${randomAccount.username}`, 302);
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
</head>
<body>
  <div class="container mt-5">
    <h1 class="mb-4">Instagram 账号管理</h1>
    
    <div class="card mb-4">
      <div class="card-body">
        <h5 class="card-title">添加新账号</h5>
        <form id="addForm">
          <div class="row g-3">
            <div class="col-md-6">
              <label class="form-label">Instagram 用户名</label>
              <input type="text" class="form-control" id="username" required>
            </div>
            <div class="col-md-6">
              <label class="form-label">自定义短代码</label>
              <input type="text" class="form-control" id="shortCode" required>
              <div class="form-text">这将作为访问链接的一部分，例如: https://instagram-redirect.w00.workers.dev/你的短代码</div>
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
          <input type="text" class="form-control" id="rotateUrl" value="${window.location.origin}" readonly>
          <button class="btn btn-outline-secondary" onclick="copyToClipboard('rotateUrl')">复制</button>
        </div>
        <small class="text-muted">访问此地址将随机跳转到一个账号</small>
      </div>
    </div>

    <div class="card">
      <div class="card-body">
        <div class="d-flex justify-content-between align-items-center mb-3">
          <h5 class="card-title mb-0">账号列表</h5>
          <button onclick="resetStats()" class="btn btn-warning">重置统计</button>
        </div>
        <div class="table-responsive">
          <table class="table">
            <thead>
              <tr>
                <th>用户名</th>
                <th>访问链接</th>
                <th>点击次数</th>
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
    const ADMIN_USERNAME = '${ADMIN_USERNAME}';
    const ADMIN_PASSWORD = '${ADMIN_PASSWORD}';

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
            'Authorization': 'Basic ' + btoa(ADMIN_USERNAME + ':' + ADMIN_PASSWORD)
          }
        });
        
        const accounts = await response.json();
        const tbody = document.getElementById('accountsList');
        tbody.innerHTML = '';
        
        const baseUrl = window.location.origin;
        
        accounts.forEach(account => {
          const tr = document.createElement('tr');
          const shortCodeId = 'shortcode_' + account.shortCode;
          
          tr.innerHTML = \`
            <td>\${account.username}</td>
            <td>
              <div class="input-group">
                <input type="text" class="form-control" id="\${shortCodeId}" value="\${baseUrl}/\${account.shortCode}" readonly>
                <button class="btn btn-outline-secondary" onclick="copyToClipboard('\${shortCodeId}')">复制</button>
              </div>
            </td>
            <td>\${account.clicks || 0}</td>
            <td>\${account.lastUsed ? new Date(account.lastUsed).toLocaleString() : '从未使用'}</td>
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
      const shortCode = document.getElementById('shortCode').value;
      
      try {
        const response = await fetch('/api/accounts', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Basic ' + btoa(ADMIN_USERNAME + ':' + ADMIN_PASSWORD)
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
      if (!confirm('确定要删除这个账号吗？')) return;
      
      try {
        const response = await fetch('/api/accounts/' + username, {
          method: 'DELETE',
          headers: {
            'Authorization': 'Basic ' + btoa(ADMIN_USERNAME + ':' + ADMIN_PASSWORD)
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
      if (!confirm('确定要重置所有统计数据吗？')) return;
      
      try {
        const response = await fetch('/api/stats/reset', {
          method: 'POST',
          headers: {
            'Authorization': 'Basic ' + btoa(ADMIN_USERNAME + ':' + ADMIN_PASSWORD)
          }
        });

        if (!response.ok) {
          alert('重置失败');
          return;
        }

        loadAccounts();
      } catch (error) {
        alert('重置失败: ' + error.message);
      }
    }

    // 页面加载完成后加载账号列表
    loadAccounts();
  </script>
</body>
</html>
`;

// 处理管理界面
async function handleAdmin(request) {
  if (!isAdmin(request)) {
    return new Response('Unauthorized', {
      status: 401,
      headers: {
        'WWW-Authenticate': 'Basic realm="Admin Area"'
      }
    });
  }

  return new Response(adminHtml, {
    headers: { 'Content-Type': 'text/html' }
  });
}

// KV 操作函数
async function listAccounts() {
  try {
    const list = await INSTAGRAM_ACCOUNTS.list({ prefix: '' });
    const accounts = [];
    for (const key of list.keys) {
      const account = await INSTAGRAM_ACCOUNTS.get(key.name, 'json');
      if (account) {
        accounts.push(account);
      }
    }
    return accounts;
  } catch (error) {
    console.error('Error listing accounts:', error);
    return [];
  }
}

async function addAccount(username, shortCode) {
  const account = {
    username,
    shortCode,
    clicks: 0,
    lastUsed: null
  };
  
  await INSTAGRAM_ACCOUNTS.put(username, JSON.stringify(account));
  await INSTAGRAM_ACCOUNTS.put(`shortcode:${shortCode}`, JSON.stringify(account));
  return account;
}

async function updateAccount(account) {
  await INSTAGRAM_ACCOUNTS.put(account.username, JSON.stringify(account));
  await INSTAGRAM_ACCOUNTS.put(`shortcode:${account.shortCode}`, JSON.stringify(account));
}

async function deleteAccount(username) {
  const account = await INSTAGRAM_ACCOUNTS.get(username, 'json');
  if (account) {
    await INSTAGRAM_ACCOUNTS.delete(username);
    await INSTAGRAM_ACCOUNTS.delete(`shortcode:${account.shortCode}`);
  }
}

// 监听请求事件
addEventListener('fetch', event => {
  event.respondWith(handleRequest(event.request));
});
