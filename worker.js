// KV 命名空间绑定名称
const KV_NAMESPACE = 'INS_ACCOUNTS'
const ADMIN_USERNAME = 'admin' // 在实际部署时更改
const ADMIN_PASSWORD = 'admin123' // 在实际部署时更改

// 处理请求的主函数
addEventListener('fetch', event => {
  event.respondWith(handleRequest(event.request))
})

async function handleRequest(request) {
  const url = new URL(request.url)
  
  // 处理管理后台路由
  if (url.pathname === '/admin') {
    return handleAdmin(request)
  }
  
  // 处理 API 请求
  if (url.pathname.startsWith('/api/')) {
    return handleAPI(request)
  }
  
  // 处理主页重定向
  if (url.pathname === '/' || url.pathname === '') {
    return handleRedirect(request)
  }

  // 返回 404
  return new Response(null, {
    status: 404,
    statusText: 'Not Found'
  })
}

// 验证管理员身份
async function authenticate(request) {
  const auth = request.headers.get('Authorization')
  if (!auth || !auth.startsWith('Basic ')) {
    return false
  }
  
  const [user, pass] = atob(auth.split(' ')[1]).split(':')
  return user === ADMIN_USERNAME && pass === ADMIN_PASSWORD
}

// 处理管理界面
async function handleAdmin(request) {
  if (!await authenticate(request)) {
    return new Response('Unauthorized', {
      status: 401,
      headers: {
        'WWW-Authenticate': 'Basic realm="Admin Access"',
        'Content-Type': 'text/plain'
      }
    })
  }

  const html = `
    <!DOCTYPE html>
    <html>
    <head>
        <meta charset="utf-8">
        <title>Instagram 账号管理</title>
        <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.1.3/dist/css/bootstrap.min.css" rel="stylesheet">
    </head>
    <body>
        <div class="container mt-5">
            <h1>Instagram 账号管理</h1>
            
            <div class="card mt-4">
                <div class="card-body">
                    <h5 class="card-title">添加新账号</h5>
                    <form id="addForm" class="row g-3">
                        <div class="col-md-5">
                            <input type="text" class="form-control" id="username" placeholder="Instagram 用户名" required>
                        </div>
                        <div class="col-md-2">
                            <button type="submit" class="btn btn-primary">添加</button>
                        </div>
                    </form>
                </div>
            </div>

            <div class="card mt-4">
                <div class="card-body">
                    <h5 class="card-title">账号列表</h5>
                    <div class="table-responsive">
                        <table class="table" id="accountsTable">
                            <thead>
                                <tr>
                                    <th>用户名</th>
                                    <th>点击次数</th>
                                    <th>操作</th>
                                </tr>
                            </thead>
                            <tbody></tbody>
                        </table>
                    </div>
                </div>
            </div>
        </div>

        <script>
            // 加载账号列表
            async function loadAccounts() {
                const response = await fetch('/api/accounts', {
                    headers: {
                        'Authorization': 'Basic ' + btoa('${ADMIN_USERNAME}:${ADMIN_PASSWORD}')
                    }
                });
                const accounts = await response.json();
                const tbody = document.querySelector('#accountsTable tbody');
                tbody.innerHTML = '';
                
                accounts.forEach(account => {
                    const tr = document.createElement('tr');
                    tr.innerHTML = \`
                        <td>\${account.username}</td>
                        <td>\${account.clicks}</td>
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
                
                await fetch('/api/accounts', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': 'Basic ' + btoa('${ADMIN_USERNAME}:${ADMIN_PASSWORD}')
                    },
                    body: JSON.stringify({ username })
                });

                document.getElementById('username').value = '';
                loadAccounts();
            };

            // 删除账号
            async function deleteAccount(username) {
                if (!confirm('确定要删除这个账号吗？')) return;
                
                await fetch(\`/api/accounts/\${username}\`, {
                    method: 'DELETE',
                    headers: {
                        'Authorization': 'Basic ' + btoa('${ADMIN_USERNAME}:${ADMIN_PASSWORD}')
                    }
                });
                
                loadAccounts();
            }

            // 初始加载
            loadAccounts();
        </script>
    </body>
    </html>
  `
  return new Response(html, {
    headers: { 'Content-Type': 'text/html;charset=utf-8' }
  })
}

// 处理 API 请求
async function handleAPI(request) {
  const url = new URL(request.url)
  
  if (!await authenticate(request)) {
    return new Response('Unauthorized', { status: 401 })
  }

  if (url.pathname === '/api/accounts') {
    if (request.method === 'GET') {
      const accounts = await listAccounts()
      return new Response(JSON.stringify(accounts), {
        headers: { 'Content-Type': 'application/json' }
      })
    }
    
    if (request.method === 'POST') {
      const { username } = await request.json()
      await addAccount(username)
      return new Response('OK')
    }
  }

  if (url.pathname.startsWith('/api/accounts/')) {
    const username = url.pathname.split('/')[3]
    if (request.method === 'DELETE') {
      await deleteAccount(username)
      return new Response('OK')
    }
  }

  return new Response('Not Found', { status: 404 })
}

// 处理重定向
async function handleRedirect(request) {
  const accounts = await listAccounts()
  if (accounts.length === 0) {
    return new Response('No accounts available', { status: 404 })
  }

  // 简单的轮询算法
  const now = Date.now()
  let minLastUsed = now
  let selectedAccount = accounts[0]

  for (const account of accounts) {
    if (account.lastUsed < minLastUsed) {
      minLastUsed = account.lastUsed
      selectedAccount = account
    }
  }

  // 更新使用时间和点击次数
  selectedAccount.lastUsed = now
  selectedAccount.clicks = (selectedAccount.clicks || 0) + 1
  await updateAccount(selectedAccount)

  // 记录访问 IP
  const clientIP = request.headers.get('CF-Connecting-IP')
  await logAccess(selectedAccount.username, clientIP)

  // 重定向到 Instagram 应用
  return Response.redirect(\`instagram://user?username=\${selectedAccount.username.replace('@', '')}\`, 302)
}

// KV 操作函数
async function listAccounts() {
  const list = await INSTAGRAM_ACCOUNTS.list()
  const accounts = []
  for (const key of list.keys) {
    if (key.name.startsWith('account:')) {
      const account = await INSTAGRAM_ACCOUNTS.get(key.name, 'json')
      accounts.push(account)
    }
  }
  return accounts
}

async function addAccount(username) {
  const account = {
    username,
    clicks: 0,
    lastUsed: 0
  }
  await INSTAGRAM_ACCOUNTS.put(\`account:\${username}\`, JSON.stringify(account))
}

async function updateAccount(account) {
  await INSTAGRAM_ACCOUNTS.put(\`account:\${account.username}\`, JSON.stringify(account))
}

async function deleteAccount(username) {
  await INSTAGRAM_ACCOUNTS.delete(\`account:\${username}\`)
}

async function logAccess(username, ip) {
  const now = new Date().toISOString()
  const logKey = \`log:\${now}\`
  await INSTAGRAM_ACCOUNTS.put(logKey, JSON.stringify({ username, ip, timestamp: now }))
}
