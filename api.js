// Talks to your own crypto-vault server (server.js) - never to any
// third party. The server does the actual balance checking; this
// app just displays what it reports and registers for push alerts.

export async function fetchBalances(serverUrl, token) {
  const res = await fetch(`${serverUrl}/api/balances`, {
    headers: token ? { 'X-Vault-Token': token } : {},
  });
  if (res.status === 401) throw new Error('unauthorized - check your access token');
  if (!res.ok) throw new Error(`server returned ${res.status}`);
  return res.json();
}

export async function registerPushToken(serverUrl, pushToken, accessToken) {
  const res = await fetch(`${serverUrl}/api/register-push-token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(accessToken ? { 'X-Vault-Token': accessToken } : {}),
    },
    body: JSON.stringify({ token: pushToken }),
  });
  if (!res.ok) throw new Error(`failed to register push token: ${res.status}`);
  return res.json();
}
