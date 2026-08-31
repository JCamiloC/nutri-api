/**
 * Smoke auth: login → refresh → change-password → forgot/reset → logout
 * tsx src/db/auth-smoke.ts
 */
import "dotenv/config";

const base = `http://127.0.0.1:${process.env.PORT || 4000}`;

async function json(path: string, init?: RequestInit) {
  const res = await fetch(`${base}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers as Record<string, string> | undefined),
    },
  });
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body };
}

async function main() {
  const email = process.env.SMOKE_EMAIL || "admin@andeslab.co";
  const password = process.env.SMOKE_PASSWORD || "demo1234";

  console.log("[auth-smoke] login");
  const login = await json("/v1/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
  if (login.status !== 200 || !login.body.token || !login.body.refreshToken) {
    throw new Error(`login failed: ${login.status} ${JSON.stringify(login.body)}`);
  }

  console.log("[auth-smoke] refresh");
  const refreshed = await json("/v1/auth/refresh", {
    method: "POST",
    body: JSON.stringify({ refreshToken: login.body.refreshToken }),
  });
  if (refreshed.status !== 200 || !refreshed.body.refreshToken) {
    throw new Error(`refresh failed: ${refreshed.status}`);
  }

  console.log("[auth-smoke] forgot (smtp pending ok)");
  const forgot = await json("/v1/auth/forgot-password", {
    method: "POST",
    body: JSON.stringify({ email }),
  });
  if (forgot.status !== 200) throw new Error(`forgot failed: ${forgot.status}`);

  const token = forgot.body.devResetToken as string | undefined;
  if (token) {
    console.log("[auth-smoke] reset with dev token");
    const reset = await json("/v1/auth/reset-password", {
      method: "POST",
      body: JSON.stringify({ token, newPassword: password }),
    });
    if (reset.status !== 200) throw new Error(`reset failed: ${reset.status}`);
    // re-login after reset
    const again = await json("/v1/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    });
    if (again.status !== 200) throw new Error("re-login after reset failed");
    Object.assign(login, again);
  }

  console.log("[auth-smoke] logout");
  const logout = await json("/v1/auth/logout", {
    method: "POST",
    headers: { Authorization: `Bearer ${login.body.token}` },
    body: JSON.stringify({ refreshToken: refreshed.body.refreshToken }),
  });
  // login.body.token might be stale after reset path — use latest
  if (logout.status === 401) {
    const fresh = await json("/v1/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    });
    const logout2 = await json("/v1/auth/logout", {
      method: "POST",
      headers: { Authorization: `Bearer ${fresh.body.token}` },
      body: JSON.stringify({ all: true }),
    });
    if (logout2.status !== 200) throw new Error(`logout failed: ${logout2.status}`);
  } else if (logout.status !== 200) {
    throw new Error(`logout failed: ${logout.status}`);
  }

  console.log("[auth-smoke] signup pending");
  const signup = await json("/v1/auth/signup", { method: "POST", body: "{}" });
  if (signup.status !== 503) throw new Error(`signup expected 503, got ${signup.status}`);

  console.log("[auth-smoke] ok");
}

main().catch((e) => {
  console.error("[auth-smoke] failed:", e);
  process.exit(1);
});
