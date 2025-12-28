import client from 'prom-client';
// Enable default metrics (CPU, memory, event loop, etc.)
client.collectDefaultMetrics({
    prefix: 'kling_',
    gcDurationBuckets: [0.001, 0.01, 0.1, 1, 2, 5],
});
// Custom metrics
export const metrics = {
    // HTTP metrics
    httpRequestDuration: new client.Histogram({
        name: 'kling_http_request_duration_seconds',
        help: 'HTTP request duration in seconds',
        labelNames: ['method', 'route', 'status'],
        buckets: [0.01, 0.05, 0.1, 0.5, 1, 2, 5, 10],
    }),
    httpRequestsTotal: new client.Counter({
        name: 'kling_http_requests_total',
        help: 'Total HTTP requests',
        labelNames: ['method', 'route', 'status'],
    }),
    // Campaign metrics
    campaignExecutionDuration: new client.Histogram({
        name: 'kling_campaign_execution_duration_seconds',
        help: 'Campaign execution duration',
        labelNames: ['campaign_id', 'status'],
        buckets: [1, 5, 10, 30, 60, 120, 300],
    }),
    campaignExecutionsTotal: new client.Counter({
        name: 'kling_campaign_executions_total',
        help: 'Total campaign executions',
        labelNames: ['status'],
    }),
    campaignAudienceSize: new client.Histogram({
        name: 'kling_campaign_audience_size',
        help: 'Number of customers in campaign audience',
        buckets: [1, 10, 50, 100, 500, 1000, 5000, 10000],
    }),
    // Message delivery metrics
    messagesSent: new client.Counter({
        name: 'kling_messages_sent_total',
        help: 'Total messages sent',
        labelNames: ['channel', 'status'],
    }),
    messageDeliveryDuration: new client.Histogram({
        name: 'kling_message_delivery_duration_seconds',
        help: 'Message delivery duration',
        labelNames: ['channel', 'provider'],
        buckets: [0.1, 0.5, 1, 2, 5, 10],
    }),
    // Queue metrics
    queueJobsProcessed: new client.Counter({
        name: 'kling_queue_jobs_processed_total',
        help: 'Total BullMQ jobs processed',
        labelNames: ['queue', 'status'],
    }),
    queueJobDuration: new client.Histogram({
        name: 'kling_queue_job_duration_seconds',
        help: 'BullMQ job processing duration',
        labelNames: ['queue'],
        buckets: [0.1, 0.5, 1, 5, 10, 30, 60],
    }),
    queueSize: new client.Gauge({
        name: 'kling_queue_size',
        help: 'Current queue size',
        labelNames: ['queue', 'state'],
    }),
    // Database metrics
    databaseQueryDuration: new client.Histogram({
        name: 'kling_database_query_duration_seconds',
        help: 'Database query duration',
        labelNames: ['operation'],
        buckets: [0.001, 0.01, 0.05, 0.1, 0.5, 1, 2],
    }),
    // Cache metrics
    cacheHits: new client.Counter({
        name: 'kling_cache_hits_total',
        help: 'Total cache hits',
        labelNames: ['cache_key'],
    }),
    cacheMisses: new client.Counter({
        name: 'kling_cache_misses_total',
        help: 'Total cache misses',
        labelNames: ['cache_key'],
    }),
    // Rate limit metrics
    rateLimitHits: new client.Counter({
        name: 'kling_rate_limit_hits_total',
        help: 'Total rate limit hits',
        labelNames: ['limiter'],
    }),
    // OpenAI metrics
    openaiRequestDuration: new client.Histogram({
        name: 'kling_openai_request_duration_seconds',
        help: 'OpenAI API request duration',
        buckets: [0.5, 1, 2, 5, 10, 30],
    }),
    openaiRequestsTotal: new client.Counter({
        name: 'kling_openai_requests_total',
        help: 'Total OpenAI API requests',
        labelNames: ['status'],
    }),
    openaiTokensUsed: new client.Counter({
        name: 'kling_openai_tokens_used_total',
        help: 'Total OpenAI tokens consumed',
        labelNames: ['model'],
    }),
    // Provider health
    providerHealth: new client.Gauge({
        name: 'kling_provider_health',
        help: 'Provider health status (1 = healthy, 0 = unhealthy)',
        labelNames: ['provider', 'channel'],
    }),
};
// Export registry for /metrics endpoint
export const register = client.register;
