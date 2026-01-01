# Kling - Production Dockerfile (Release Repository)
# This Dockerfile is used with pre-built artifacts from kling-releases
# Build: docker build -t kling:latest .
# Run: docker run -d -p 3001:3001 -v kling-data:/data kling:latest

FROM node:22-bookworm-slim AS production

WORKDIR /app

# Install system dependencies including MongoDB and Redis
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ \
    gnupg curl wget ca-certificates git \
    supervisor \
    redis-server redis-tools \
    && rm -rf /var/lib/apt/lists/*

# Add MongoDB repository and install
RUN curl -fsSL https://www.mongodb.org/static/pgp/server-7.0.asc | gpg --dearmor -o /usr/share/keyrings/mongodb-server-7.0.gpg \
    && echo "deb [ signed-by=/usr/share/keyrings/mongodb-server-7.0.gpg ] http://repo.mongodb.org/apt/debian bookworm/mongodb-org/7.0 main" | tee /etc/apt/sources.list.d/mongodb-org-7.0.list \
    && apt-get update \
    && apt-get install -y mongodb-org-server mongodb-org-shell \
    && rm -rf /var/lib/apt/lists/*

# Copy pre-built application files
COPY package*.json ./
COPY dist ./dist
COPY public ./public
COPY prisma ./prisma

# Install production dependencies only
RUN npm install --omit=dev

# Generate Prisma client
RUN npx prisma generate

# Create log directory
RUN mkdir -p /var/log/supervisor

# Create init script for data directories
RUN printf '#!/bin/bash\nmkdir -p /data/mongodb /data/redis\nexec /usr/bin/supervisord -c /etc/supervisord.conf\n' > /app/start.sh && chmod +x /app/start.sh

# Create supervisor config
RUN cat > /etc/supervisord.conf << 'EOF'
[supervisord]
nodaemon=true
logfile=/var/log/supervisor/supervisord.log
pidfile=/var/run/supervisord.pid
user=root

[program:mongodb]
command=mongod --dbpath /data/mongodb --bind_ip 127.0.0.1 --port 27017 --quiet
autostart=true
autorestart=true
stdout_logfile=/var/log/supervisor/mongodb.log
stderr_logfile=/var/log/supervisor/mongodb_err.log
priority=10

[program:redis]
command=redis-server --dir /data/redis --bind 127.0.0.1 --port 6379 --appendonly yes
autostart=true
autorestart=true
stdout_logfile=/var/log/supervisor/redis.log
stderr_logfile=/var/log/supervisor/redis_err.log
priority=10

[program:kling]
command=/app/wait-for-services.sh
directory=/app
autostart=true
autorestart=true
stdout_logfile=/dev/stdout
stdout_logfile_maxbytes=0
stderr_logfile=/dev/stderr
stderr_logfile_maxbytes=0
environment=NODE_ENV="production",PORT="3001",DATABASE_URL="mongodb://127.0.0.1:27017/kling",REDIS_URL="redis://127.0.0.1:6379"
priority=20
startsecs=5
startretries=3
EOF

# Create startup wrapper script that waits for services
RUN cat > /app/wait-for-services.sh << 'EOF'
#!/bin/bash

# Wait for MongoDB to be ready
echo "Waiting for MongoDB..."
until mongosh --quiet --eval "db.adminCommand('ping')" mongodb://127.0.0.1:27017 > /dev/null 2>&1; do
  sleep 1
done
echo "MongoDB is ready"

# Wait for Redis to be ready
echo "Waiting for Redis..."
until redis-cli -h 127.0.0.1 ping > /dev/null 2>&1; do
  sleep 1
done
echo "Redis is ready"

# Run migrations (safe to run multiple times)
echo "Running database migrations..."
npx prisma migrate deploy || true

# Start the Node.js application
exec node --import tsx /app/dist/index.js
EOF

RUN chmod +x /app/wait-for-services.sh

# Expose port
EXPOSE 3001

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:3001/v1/health || exit 1

# Start via init script
CMD ["/app/start.sh"]
