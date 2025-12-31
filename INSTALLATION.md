# Kling Installation Guide

A step-by-step guide to install Kling on your own server. No advanced technical knowledge required.

## What You'll Need

Before starting, make sure you have:

- [ ] A server running **Ubuntu 22.04** (recommended) or similar Linux
- [ ] A domain name (e.g., `marketing.yourcompany.com`)
- [ ] SSH access to your server
- [ ] About 30-45 minutes

**Server Requirements**:
| Resource | Minimum | Recommended |
|----------|---------|-------------|
| RAM | 2 GB | 4 GB |
| CPU | 2 cores | 4 cores |
| Disk | 20 GB | 50 GB SSD |

---

## Step 1: Connect to Your Server

Open a terminal on your computer and connect to your server:

```bash
ssh your-username@your-server-ip
```

Replace `your-username` with your server username and `your-server-ip` with your server's IP address.

---

## Step 2: Update Your Server

Run these commands to ensure your server is up to date:

```bash
sudo apt update
sudo apt upgrade -y
```

This may take a few minutes. Type `Y` and press Enter if prompted.

---

## Step 3: Install Docker

Docker is the software that runs Kling. Install it with this command:

```bash
curl -fsSL https://get.docker.com | sudo sh
```

Then add yourself to the Docker group (so you don't need `sudo` every time):

```bash
sudo usermod -aG docker $USER
```

**Important**: Log out and log back in for this to take effect:

```bash
exit
```

Then reconnect:

```bash
ssh your-username@your-server-ip
```

Verify Docker is working:

```bash
docker --version
```

You should see something like `Docker version 24.x.x`.

---

## Step 4: Download Kling

Download Kling to your server:

```bash
git clone https://github.com/your-org/kling.git
cd kling
```

---

## Step 5: Configure Kling

### 5.1 Create Your Configuration File

Copy the example configuration:

```bash
cp .env.prod.example .env.prod
```

### 5.2 Generate Secure Passwords

Run these commands to generate secure passwords. **Save these somewhere safe** - you'll need them:

```bash
echo "Your JWT Secret:"
openssl rand -base64 32

echo "Your Encryption Key:"
openssl rand -hex 32

echo "Your MongoDB Password:"
openssl rand -base64 24

echo "Your Redis Password:"
openssl rand -base64 24
```

### 5.3 Edit the Configuration

Open the configuration file:

```bash
nano .env.prod
```

Update these values with your information:

```bash
# Your domain (change this!)
BASE_URL=https://marketing.yourcompany.com

# Paste the passwords you generated above
JWT_SECRET=paste-your-jwt-secret-here
ENCRYPTION_KEY=paste-your-encryption-key-here
MONGO_ROOT_PASSWORD=paste-your-mongodb-password-here
REDIS_PASSWORD=paste-your-redis-password-here
```

**To save the file**: Press `Ctrl+X`, then `Y`, then `Enter`.

---

## Step 6: Set Up SSL Certificate

SSL makes your connection secure (the padlock icon in browsers).

### 6.1 Install Certbot

```bash
sudo apt install certbot -y
```

### 6.2 Get Your Certificate

Replace `marketing.yourcompany.com` with your actual domain and `you@example.com` with your email:

```bash
sudo certbot certonly --standalone \
  -d marketing.yourcompany.com \
  --agree-tos \
  --email you@example.com \
  --non-interactive
```

### 6.3 Copy Certificate to Kling

```bash
mkdir -p nginx/ssl
sudo cp /etc/letsencrypt/live/marketing.yourcompany.com/fullchain.pem nginx/ssl/
sudo cp /etc/letsencrypt/live/marketing.yourcompany.com/privkey.pem nginx/ssl/
sudo chown $USER:$USER nginx/ssl/*.pem
```

Replace `marketing.yourcompany.com` with your domain.

---

## Step 7: Update Domain in Nginx

Open the Nginx configuration:

```bash
nano nginx/nginx.conf
```

Find this line (use `Ctrl+W` to search):

```
server_name _;
```

Change it to your domain:

```
server_name marketing.yourcompany.com;
```

**Save**: Press `Ctrl+X`, then `Y`, then `Enter`.

---

## Step 8: Open Firewall Ports

Allow web traffic through your firewall:

```bash
sudo ufw allow 22/tcp   # SSH (so you don't lock yourself out!)
sudo ufw allow 80/tcp   # HTTP
sudo ufw allow 443/tcp  # HTTPS
sudo ufw enable
```

Type `y` when prompted.

---

## Step 9: Start Kling

Now for the exciting part! Start Kling:

```bash
docker compose -f docker-compose.prod.yml up -d
```

This will download and start all the components. It may take 5-10 minutes the first time.

### 9.1 Initialize the Database

Wait about 30 seconds, then run:

```bash
docker exec kling-mongodb mongosh --eval "rs.initiate()"
```

You should see `{ ok: 1 }`.

### 9.2 Check Everything is Running

```bash
docker compose -f docker-compose.prod.yml ps
```

You should see all services with status `Up` or `healthy`.

---

## Step 10: Create Your Admin Account

1. Open your browser and go to `https://marketing.yourcompany.com`
2. Click **Register**
3. Enter your email and a strong password
4. The first user automatically becomes the admin!

---

## You're Done!

Kling is now running. Here's what to do next:

1. **Configure Email Provider**: Go to Settings → Providers → Add your Resend API key
2. **Configure SMS Provider** (optional): Add Twilio credentials
3. **Import Customers**: Go to Customers → Import
4. **Create Your First Campaign**: Go to Campaigns → New Campaign

---

## Common Issues

### "Cannot connect to the Docker daemon"

Docker isn't running. Start it:

```bash
sudo systemctl start docker
```

### "Port 80 already in use"

Another service is using port 80. Stop it:

```bash
sudo systemctl stop nginx
sudo systemctl stop apache2
```

### "Connection refused" when visiting your domain

1. Check your domain's DNS points to your server's IP
2. Wait 5-10 minutes for DNS to update
3. Make sure the firewall allows ports 80 and 443

### Services keep restarting

Check the logs for errors:

```bash
docker compose -f docker-compose.prod.yml logs backend
```

### Forgot your admin password?

Connect to the database and reset it:

```bash
docker exec -it kling-mongodb mongosh kling --eval "
  db.User.updateOne(
    { email: 'your@email.com' },
    { \$set: { password: '\$2b\$10\$...' } }
  )
"
```

Contact support for password reset assistance.

---

## Keeping Kling Updated

When a new version is released:

```bash
cd kling
git pull
docker compose -f docker-compose.prod.yml down
docker compose -f docker-compose.prod.yml build --no-cache
docker compose -f docker-compose.prod.yml up -d
```

---

## Backing Up Your Data

Set up automatic daily backups:

```bash
# Make the backup script executable
chmod +x scripts/backup.sh

# Add to cron (runs at 2 AM daily)
(crontab -l 2>/dev/null; echo "0 2 * * * cd $(pwd) && ./scripts/backup.sh") | crontab -
```

Backups are saved in the `./backups` folder.

---

## Getting Help

- **Documentation**: Check other files in the `docs/` folder
- **Issues**: Report problems at https://github.com/your-org/kling/issues
- **Community**: Join our Discord at https://discord.gg/kling

---

## Quick Reference

| What | Command |
|------|---------|
| Start Kling | `docker compose -f docker-compose.prod.yml up -d` |
| Stop Kling | `docker compose -f docker-compose.prod.yml down` |
| View logs | `docker compose -f docker-compose.prod.yml logs -f` |
| Check status | `docker compose -f docker-compose.prod.yml ps` |
| Restart | `docker compose -f docker-compose.prod.yml restart` |
| Backup | `./scripts/backup.sh` |

---

*Last updated: December 2024*
