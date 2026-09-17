# AWS: EC2 (nutri-api) + Amplify (nutri-saas)

Repos:

| Repo | GitHub | Destino |
|------|--------|---------|
| nutri-api | `JCamiloC/nutri-api` | EC2 **t3.medium** |
| nutri-saas | `JCamiloC/nutri-saas` | **Amplify Hosting** |

Deploy automático en **push a `main`**:

- **API:** GitHub Action `.github/workflows/deploy-ec2.yml` → SSH → `scripts/ec2-deploy.sh`
- **Front:** Amplify conectado al repo → build `amplify.yml` → publica `out/`

Desactiva el workflow viejo de FTP en nutri-saas (`.github/workflows/deploy.yml`) en GitHub → Actions → Disable workflow, para no publicar en Hostinger a la vez.

---

## 1. EC2 — crear instancia (consola AWS)

1. **Región:** la que uses para Enerxis (ej. `us-east-1`).
2. **EC2 → Launch instance**
   - Name: `enerxis-nutri-api`
   - AMI: **Ubuntu Server 24.04 LTS**
   - Instance type: **t3.medium**
   - Key pair: **Create** → descarga el `.pem` (guárdalo; lo usarás en GitHub Secrets).
   - Network: VPC por defecto, **Auto-assign public IP: Enable**
   - Security group (crear nuevo):
     - SSH **22** → **My IP** (no 0.0.0.0/0)
     - HTTP **80** → 0.0.0.0/0
     - HTTPS **443** → 0.0.0.0/0
     - **No** abras 4000 ni 5432 al mundo
   - Storage: **30 GiB** gp3
3. **Launch**
4. **Elastic IP** (recomendado): EC2 → Elastic IPs → Allocate → Associate a la instancia. Usa esa IP en DNS y en `EC2_HOST`.

---

## 2. EC2 — primer arranque (SSH)

Desde tu PC (PowerShell), con la ruta a tu `.pem`:

```powershell
ssh -i "C:\ruta\enerxis.pem" ubuntu@TU_ELASTIC_IP
```

En la instancia (copiar/pegar por bloques):

```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y git nginx certbot python3-certbot-nginx unzip curl

# Node 20
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
sudo npm i -g pm2

# Docker (Postgres local en la misma EC2)
sudo apt install -y docker.io docker-compose-plugin
sudo usermod -aG docker ubuntu
# Cierra sesión SSH y vuelve a entrar para que docker funcione sin sudo
```

Deploy key para clonar **nutri-api** (repo privado):

```bash
ssh-keygen -t ed25519 -C nutri-api-ec2 -f ~/.ssh/nutri-api-deploy -N ""
cat ~/.ssh/nutri-api-deploy.pub
```

Copia la clave pública → GitHub **nutri-api** → Settings → Deploy keys → Add (read-only).

```bash
cat >> ~/.ssh/config << 'EOF'
Host github.com
  HostName github.com
  User git
  IdentityFile ~/.ssh/nutri-api-deploy
  IdentitiesOnly yes
EOF
chmod 600 ~/.ssh/config ~/.ssh/nutri-api-deploy

sudo mkdir -p /opt/nutri-api
sudo chown ubuntu:ubuntu /opt/nutri-api
git clone git@github.com:JCamiloC/nutri-api.git /opt/nutri-api
cd /opt/nutri-api
```

Crea `.env` (no va en git):

```bash
nano /opt/nutri-api/.env
```

Ejemplo mínimo:

```env
PORT=4000
NODE_ENV=production
CORS_ORIGIN=https://main.xxxxx.amplifyapp.com,https://app.tudominio.com

DATABASE_URL=postgresql://nutri:CAMBIA_PASSWORD@127.0.0.1:5432/nutri_lab

JWT_SECRET=genera-un-string-largo-aleatorio
APP_PUBLIC_URL=https://app.tudominio.com
API_PUBLIC_URL=https://api.tudominio.com

USDA_API_KEY=tu-clave
MFA_CODE_MINUTES=10

# SMTP cuando lo tengas
# SMTP_HOST=...
# SMTP_PORT=587
# SMTP_USER=...
# SMTP_PASS=...
# SMTP_FROM="NutriLab <noreply@enerxis.com>"
```

Postgres con Docker (cambia password en compose y en DATABASE_URL):

```bash
cd /opt/nutri-api
docker compose up -d
npm ci
npm run db:migrate
npm run db:import-catalog
npm run build
pm2 start dist/index.js --name nutri-api --cwd /opt/nutri-api
pm2 startup
# ejecuta el comando que imprime pm2 startup
pm2 save
curl -s http://127.0.0.1:4000/health
```

Nginx + HTTPS (cuando `api.tudominio.com` apunte a la Elastic IP):

```bash
sudo tee /etc/nginx/sites-available/nutri-api << 'EOF'
server {
  listen 80;
  server_name api.tudominio.com;

  client_max_body_size 25m;

  location / {
    proxy_pass http://127.0.0.1:4000;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }
}
EOF
sudo ln -sf /etc/nginx/sites-available/nutri-api /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d api.tudominio.com
```

---

## 3. GitHub — deploy automático del API

Repo **nutri-api** → Settings → Secrets and variables → Actions:

| Secret | Valor |
|--------|--------|
| `EC2_HOST` | Elastic IP o DNS |
| `EC2_USER` | `ubuntu` |
| `EC2_SSH_KEY` | Contenido **completo** del `.pem` (incluye BEGIN/END) |
| `EC2_PATH` | `/opt/nutri-api` (opcional) |

En la EC2, la clave pública del par usado en Actions debe estar en `~ubuntu/.ssh/authorized_keys`. Opción simple: usar el **mismo** `.pem` de AWS (sube la clave pública derivada) o generar un par solo para Actions.

Push a `main` con el workflow `deploy-ec2.yml` en el repo → Actions debe correr `scripts/ec2-deploy.sh` (migrate, import-catalog, build, pm2 restart).

---

## 4. Amplify — front nutri-saas

1. Consola **AWS Amplify** → **Create new app** → **Host web app**
2. **GitHub** → autoriza → repo **`JCamiloC/nutri-saas`**, branch **`main`**
3. Amplify detecta `amplify.yml` en la raíz (si no, pega el contenido del archivo del repo).
4. **Environment variables** (build time):

   | Variable | Ejemplo |
   |----------|---------|
   | `NEXT_PUBLIC_API_URL` | `https://api.tudominio.com` |

5. **Save and deploy**
6. **Rewrites:** no uses catch-all `/* → /index.html` (Next export ya genera rutas con `/index.html`).
7. **Custom domain** (opcional): `app.tudominio.com` → Amplify te da CNAME.

Cada **push a `main`** en nutri-saas → Amplify rebuild y publica solo.

Actualiza `CORS_ORIGIN` en el `.env` del API con la URL de Amplify (`https://main.xxxx.amplifyapp.com`) y tu dominio custom, luego `pm2 restart nutri-api`.

---

## 5. Checklist post-deploy

- [ ] `https://api.tudominio.com/health` → ok
- [ ] Login desde la URL de Amplify
- [ ] DevTools: requests a `NEXT_PUBLIC_API_URL`, no localhost
- [ ] `npm run db:migrate` en logs de GitHub Action tras un push con SQL nuevo
- [ ] Logo en correos: `API_PUBLIC_URL` accesible desde internet

---

## 6. Orden recomendado al desarrollar

1. Push **nutri-api** (migrate en EC2)
2. Push **nutri-saas** (Amplify) si cambiaste el front o `NEXT_PUBLIC_*`

No hace falta redeploy del front solo por cambios de BD; sí hace falta redeploy del front si cambias `NEXT_PUBLIC_API_URL`.
