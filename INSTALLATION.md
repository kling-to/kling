# Kling Installation Guide

A step-by-step guide to install Kling on your own server.

## What You'll Need

Before starting, make sure you have:

- A server running **Ubuntu 22.04** (recommended) or similar Linux
- A domain name (e.g., `marketing.yourcompany.com`)
- SSH access to your server
- About 15-30 minutes

**Server Requirements**:

| Resource | Minimum | Recommended |
|----------|---------|-------------|
| RAM      | 2 GB    | 4 GB        |
| CPU      | 2 cores | 4 cores     |
| Disk     | 20 GB   | 50 GB SSD   |

---

## Option A: Docker Compose (Recommended)

The simplest way to run Kling. Uses separate containers for the app, database, and cache.

### Step 1: Install Docker

```bash
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER
```

Log out and back in for the group change to take effect.

### Step 2: Create Project Directory

```bash
mkdir -p ~/kling && cd ~/kling
```

### Step 3: Download Docker Compose File

```bash
curl -O https://raw.githubusercontent.com/kling-to/kling/main/docker-compose.production.yml
```

### Step 4: Create Environment File

```bash
cat > .env << EOF
JWT_SECRET=$(openssl rand -base64 32)
ENCRYPTION_KEY=$(openssl rand -hex 32)
EOF
```

### Step 5: Start Kling

```bash
docker compose -f docker-compose.production.yml up -d
```

That's it! Kling is now running at `http://your-server-ip:3001`.

### Step 6: Create Admin Account

Open `http://your-server-ip:3001` in your browser and register. The first user automatically becomes the administrator.

### Step 7: Set Up a Reverse Proxy (Optional)

For HTTPS and a custom domain, install Nginx and Certbot:

```bash
sudo apt install nginx certbot python3-certbot-nginx -y
```

Create `/etc/nginx/sites-available/kling`:

```nginx
server {
    listen 80;
    server_name marketing.yourcompany.com;

    location / {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
}
```

Enable and get SSL:

```bash
sudo ln -s /etc/nginx/sites-available/kling /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d marketing.yourcompany.com
```

---

## Option B: Manual Installation

For more control over individual components.

### Step 1: Connect to Your Server

```bash
ssh your-username@your-server-ip
```

### Step 2: Install Dependencies

```bash
# Update system
sudo apt update && sudo apt upgrade -y

# Install Node.js 22
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs

# Install MongoDB 7
curl -fsSL https://www.mongodb.org/static/pgp/server-7.0.asc | \
  sudo gpg --dearmor -o /usr/share/keyrings/mongodb-server-7.0.gpg
echo "deb [ signed-by=/usr/share/keyrings/mongodb-server-7.0.gpg ] http://repo.mongodb.org/apt/ubuntu jammy/mongodb-org/7.0 multiverse" | \
  sudo tee /etc/apt/sources.list.d/mongodb-org-7.0.list
sudo apt update && sudo apt install -y mongodb-org

# Install Redis
sudo apt install -y redis-server

# Start services
sudo systemctl enable --now mongod redis-server
```

### Step 3: Configure MongoDB as Replica Set

MongoDB must run as a replica set for Prisma transactions:

```bash
# Edit MongoDB config
sudo nano /etc/mongod.conf
```

Add or modify the replication section:

```yaml
replication:
  replSetName: rs0
```

Restart MongoDB and initialize the replica set:

```bash
sudo systemctl restart mongod
mongosh --eval "rs.initiate({_id:'rs0',members:[{_id:0,host:'localhost:27017'}]})"
```

### Step 4: Download Kling

```bash
cd /opt
sudo git clone https://github.com/kling-to/kling.git
sudo chown -R $USER:$USER kling
cd kling
```

Checkout the latest release:

```bash
git fetch --tags
git checkout $(git describe --tags $(git rev-list --tags --max-count=1))
```

### Step 5: Install Dependencies

```bash
npm install --omit=dev
npx prisma generate
```

### Step 6: Configure Environment

```bash
cp .env.example .env
```

Edit `.env` with your settings:

```bash
nano .env
```

Required variables:

```bash
# Database (MongoDB replica set)
DATABASE_URL="mongodb://127.0.0.1:27017/kling?replicaSet=rs0"

# Security - generate these!
JWT_SECRET="your-generated-secret"
ENCRYPTION_KEY="your-generated-key"

# Server
PORT=3001
NODE_ENV=production

# Redis
REDIS_URL="redis://127.0.0.1:6379"
```

Generate secure values:

```bash
echo "JWT_SECRET: $(openssl rand -base64 32)"
echo "ENCRYPTION_KEY: $(openssl rand -hex 32)"
```

### Step 7: Create Systemd Service

```bash
sudo tee /etc/systemd/system/kling.service << 'EOF'
[Unit]
Description=Kling Marketing Automation
After=network.target mongod.service redis-server.service
Requires=mongod.service redis-server.service

[Service]
Type=simple
User=www-data
WorkingDirectory=/opt/kling
ExecStart=/usr/bin/node --import tsx dist/index.js
Restart=on-failure
RestartSec=10
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
EOF
```

Enable and start:

```bash
sudo chown -R www-data:www-data /opt/kling
sudo systemctl daemon-reload
sudo systemctl enable --now kling
```

### Step 8: Set Up Nginx

```bash
sudo apt install nginx certbot python3-certbot-nginx -y
```

Create `/etc/nginx/sites-available/kling`:

```nginx
server {
    listen 80;
    server_name marketing.yourcompany.com;

    # API endpoints
    location /v1 {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # Frontend
    location / {
        root /opt/kling/public;
        try_files $uri $uri/ /index.html;
    }
}
```

Enable and get SSL:

```bash
sudo ln -s /etc/nginx/sites-available/kling /etc/nginx/sites-enabled/
sudo rm /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d marketing.yourcompany.com
```

### Step 9: Open Firewall

```bash
sudo ufw allow 22/tcp
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw --force enable
```

---

## First Login

1. Open your browser to `https://marketing.yourcompany.com`
2. Click **Register** to create your admin account
3. The first user automatically becomes the administrator

---

## Post-Installation Setup

1. **Configure Email Provider**: Settings > Providers > Add your Resend/SendGrid API key
2. **Configure SMS Provider** (optional): Add Twilio credentials
3. **Import Customers**: Customers > Import
4. **Create Your First Campaign**: Campaigns > New Campaign

---

## Updating Kling

### Docker Compose

```bash
cd ~/kling
docker compose -f docker-compose.production.yml pull
docker compose -f docker-compose.production.yml up -d
```

### Manual Installation

```bash
cd /opt/kling
git fetch --tags
git checkout $(git describe --tags $(git rev-list --tags --max-count=1))
npm install --omit=dev
npx prisma generate
sudo systemctl restart kling
```

---

## Backing Up Your Data

### Docker Compose

```bash
cd ~/kling

# Backup MongoDB
docker compose -f docker-compose.production.yml exec mongodb \
  mongodump --archive --gzip > backup-$(date +%Y%m%d).gz

# Backup .env file
cp .env .env.backup-$(date +%Y%m%d)
```

### Manual Installation

```bash
# Backup MongoDB
mongodump --out=/backup/kling-$(date +%Y%m%d)

# Backup uploads and config
tar czf /backup/kling-files-$(date +%Y%m%d).tar.gz /opt/kling/.env /opt/kling/uploads
```

---

## Troubleshooting

### Container won't start

Check logs:

```bash
docker compose -f docker-compose.production.yml logs kling
```

### "Connection refused" errors

Ensure services are running:

```bash
# Docker
docker compose -f docker-compose.production.yml ps

# Manual
sudo systemctl status mongod redis-server kling
```

### Database connection issues

Verify MongoDB replica set is initialized:

```bash
# Docker
docker compose -f docker-compose.production.yml exec mongodb mongosh --eval "rs.status()"

# Manual
mongosh --eval "rs.status()"
```

### Port already in use

Check what's using port 3001:

```bash
sudo lsof -i :3001
```

---

## Quick Reference

| Action | Docker Compose | Manual |
|--------|----------------|--------|
| Start | `docker compose -f docker-compose.production.yml up -d` | `sudo systemctl start kling` |
| Stop | `docker compose -f docker-compose.production.yml down` | `sudo systemctl stop kling` |
| Restart | `docker compose -f docker-compose.production.yml restart` | `sudo systemctl restart kling` |
| View logs | `docker compose -f docker-compose.production.yml logs -f kling` | `sudo journalctl -u kling -f` |
| Check status | `docker compose -f docker-compose.production.yml ps` | `sudo systemctl status kling` |

---

## Getting Help

- **Website**: [kling.to](https://kling.to)
- **Documentation**: [kling.to/docs](https://kling.to/docs)
- **Issues**: [github.com/kling-to/kling/issues](https://github.com/kling-to/kling/issues)

---

## One-Click Install

Prefer managed hosting? Get started instantly at [kling.to/installations/new](https://kling.to/installations/new)
