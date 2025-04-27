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
  const url = new URL(request.url)
  const path = url.pathname.slice(5) // 移除开头的 /api/

  // 验证管理员身份
  if (!isAdmin(request)) {
    return new Response('Unauthorized', { status: 401 })
  }

  if (path === 'accounts' && request.method === 'POST') {
    const { username, shortCode, customUrl } = await request.json()
    
    // 验证用户名格式
    if (!username || typeof username !== 'string') {
      return new Response('Invalid username', { status: 400 })
    }

    // 如果提供了自定义短代码，验证其格式
    if (shortCode && (typeof shortCode !== 'string' || shortCode.length !== 8)) {
      return new Response('Short code must be 8 characters', { status: 400 })
    }

    // 如果提供了自定义链接，验证其格式
    if (customUrl && typeof customUrl !== 'string') {
      return new Response('Invalid custom URL', { status: 400 })
    }

    // 生成或使用提供的短代码
    const finalShortCode = shortCode || generateShortCode()
    
    // 保存账号信息
    const account = {
      username,
      shortCode: finalShortCode,
      customUrl: customUrl || null,
      clicks: 0,
      lastUsed: null
    }

    await INSTAGRAM_ACCOUNTS.put(username, JSON.stringify(account))
    await INSTAGRAM_ACCOUNTS.put(`shortcode:${finalShortCode}`, JSON.stringify(account))

    return new Response(JSON.stringify(account), {
      headers: { 'Content-Type': 'application/json' }
    })
  }

  // 其他 API 处理保持不变...
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

  // 处理重定向
  if (path) {
    // 先检查是否是短代码
    let account = await INSTAGRAM_ACCOUNTS.get(`shortcode:${path}`, 'json')
    
    if (!account) {
      // 遍历所有账号查找匹配的自定义链接
      const accountsList = await listAccounts()
      account = accountsList.find(a => a.customUrl === path)
    }

    if (account) {
      // 更新点击次数
      account.clicks = (account.clicks || 0) + 1
      account.lastUsed = Date.now()
      await updateAccount(account)
      
      // 记录访问 IP
      const clientIP = request.headers.get('CF-Connecting-IP')
      await logAccess(account.username, clientIP)
      
      // 重定向到 Instagram 应用
      return Response.redirect(`instagram://user?username=${account.username}`, 302)
    }
  }
  
  // 默认重定向到管理界面
  return Response.redirect(`${url.origin}/admin`, 302)
}

// 修改管理界面HTML
async function handleAdmin(request) {
  if (!isAdmin(request)) {
    return new Response('Unauthorized', {
      status: 401,
      headers: {
        'WWW-Authenticate': 'Basic realm="Admin Area"'
      }
    })
  }

  const accounts = await listAccounts()
  const baseUrl = new URL(request.url).origin

  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <title>Instagram 账号管理</title>
      <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.1.3/dist/css/bootstrap.min.css" rel="stylesheet">
      <style>
        body { padding: 20px; }
        .container { max-width: 1000px; }
      </style>
    </head>
    <body>
      <div class="container">
        <h1 class="mb-4">Instagram 账号管理</h1>
        
        <div class="card mb-4">
          <div class="card-body">
            <h5 class="card-title">添加新账号</h5>
            <form id="addForm" class="row g-3">
              <div class="col-md-4">
                <input type="text" class="form-control" id="username" placeholder="Instagram 用户名" required>
              </div>
              <div class="col-md-3">
                <input type="text" class="form-control" id="shortCode" placeholder="自定义8位短代码（选填）" maxlength="8">
              </div>
              <div class="col-md-3">
                <input type="text" class="form-control" id="customUrl" placeholder="自定义链接（选填）">
              </div>
              <div class="col-md-2">
                <button type="submit" class="btn btn-primary">添加</button>
              </div>
            </form>
          </div>
        </div>

        <div class="card">
          <div class="card-body">
            <h5 class="card-title">账号列表</h5>
            <table class="table">
              <thead>
                <tr>
                  <th>用户名</th>
                  <th>短链接</th>
                  <th>自定义链接</th>
                  <th>点击次数</th>
                  <th>最后使用时间</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody id="accountsList"></tbody>
            </table>
            <button onclick="resetStats()" class="btn btn-warning">重置统计</button>
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
          const response = await fetch('/api/accounts', {
            headers: {
              'Authorization': 'Basic ' + btoa(`${ADMIN_USERNAME}:${ADMIN_PASSWORD}`)
            }
          });
          
          const accounts = await response.json();
          const tbody = document.getElementById('accountsList');
          tbody.innerHTML = '';
          
          const baseUrl = window.location.origin;
          
          accounts.forEach(account => {
            const tr = document.createElement('tr');
            const shortCodeId = 'shortcode_' + account.shortCode;
            const customUrlId = 'customurl_' + account.shortCode;
            
            tr.innerHTML = \`
              <td>\${account.username}</td>
              <td>
                <div class="input-group">
                  <input type="text" class="form-control" id="\${shortCodeId}" value="\${baseUrl}/\${account.shortCode}" readonly>
                  <button class="btn btn-outline-secondary copy-btn" onclick="copyToClipboard('\${shortCodeId}')">复制</button>
                </div>
              </td>
              <td>
                \${account.customUrl ? \`
                  <div class="input-group">
                    <input type="text" class="form-control" id="\${customUrlId}" value="\${baseUrl}/\${account.customUrl}" readonly>
                    <button class="btn btn-outline-secondary copy-btn" onclick="copyToClipboard('\${customUrlId}')">复制</button>
                  </div>
                \` : '-'}
              </td>
              <td>\${account.clicks || 0}</td>
              <td>\${account.lastUsed ? new Date(account.lastUsed).toLocaleString() : '从未使用'}</td>
              <td>
                <button onclick="deleteAccount('\${account.username}')" class="btn btn-sm btn-danger">删除</button>
              </td>
            \`;
            tbody.appendChild(tr);
          });
        }

        // 添加账号
        document.getElementById('addForm').onsubmit = async (e) => {
          e.preventDefault();
          const username = document.getElementById('username').value;
          const shortCode = document.getElementById('shortCode').value;
          const customUrl = document.getElementById('customUrl').value;
          
          await fetch('/api/accounts', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': 'Basic ' + btoa(`${ADMIN_USERNAME}:${ADMIN_PASSWORD}`)
            },
            body: JSON.stringify({ 
              username,
              shortCode: shortCode || undefined,
              customUrl: customUrl || undefined
            })
          });

          document.getElementById('username').value = '';
          document.getElementById('shortCode').value = '';
          document.getElementById('customUrl').value = '';
          loadAccounts();
        };

        // 删除账号
        async function deleteAccount(username) {
          if (!confirm('确定要删除这个账号吗？')) return;
          
          await fetch(`/api/accounts/${username}`, {
            method: 'DELETE',
            headers: {
              'Authorization': 'Basic ' + btoa(`${ADMIN_USERNAME}:${ADMIN_PASSWORD}`)
            }
          });
          
          loadAccounts();
        }

        // 重置统计
        async function resetStats() {
          if (!confirm('确定要重置所有统计数据吗？')) return;
          
          await fetch('/api/stats/reset', {
            method: 'POST',
            headers: {
              'Authorization': 'Basic ' + btoa(`${ADMIN_USERNAME}:${ADMIN_PASSWORD}`)
            }
          });
          
          loadAccounts();
        }

        // 页面加载完成后加载账号列表
        loadAccounts();
      </script>
    </body>
    </html>
  `;

  return new Response(html, {
    headers: {
      'Content-Type': 'text/html;charset=UTF-8'
    }
  });
}

// KV 操作函数
async function listAccounts() {
  try {
    const list = await INSTAGRAM_ACCOUNTS.list({ prefix: 'account:' });
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

async function addAccount(username, shortCode, customUrl) {
  const account = {
    username,
    shortCode,
    customUrl,
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

async function logAccess(username, ip) {
  const now = Date.now();
  const logKey = `log:${now}`;
  await INSTAGRAM_ACCOUNTS.put(logKey, JSON.stringify({ username, ip, timestamp: now }));
}

// 监听请求事件
addEventListener('fetch', event => {
  event.respondWith(handleRequest(event.request));
});
