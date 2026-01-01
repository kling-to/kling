import { S3Client, PutObjectCommand, GetObjectCommand, ListObjectsV2Command, DeleteObjectCommand, HeadBucketCommand, } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { createReadStream, createWriteStream } from 'fs';
import { stat } from 'fs/promises';
import { pipeline } from 'stream/promises';
import prisma from './prisma';
async function getS3Client() {
    const settings = await prisma.settings.findFirst();
    if (!settings?.backupS3Bucket ||
        !settings?.backupS3AccessKeyId ||
        !settings?.backupS3SecretAccessKey) {
        throw new Error('S3 backup settings are not configured');
    }
    const config = {
        bucket: settings.backupS3Bucket,
        region: settings.backupS3Region,
        accessKeyId: settings.backupS3AccessKeyId,
        secretAccessKey: settings.backupS3SecretAccessKey,
        endpoint: settings.backupS3Endpoint ?? undefined,
    };
    const client = new S3Client({
        region: config.region,
        credentials: {
            accessKeyId: config.accessKeyId,
            secretAccessKey: config.secretAccessKey,
        },
        ...(config.endpoint ? { endpoint: config.endpoint, forcePathStyle: true } : {}),
    });
    return { client, bucket: config.bucket, config };
}
export async function uploadBackupToS3(localPath, s3Key) {
    const { client, bucket } = await getS3Client();
    const fileStats = await stat(localPath);
    const fileStream = createReadStream(localPath);
    const command = new PutObjectCommand({
        Bucket: bucket,
        Key: s3Key,
        Body: fileStream,
        ContentType: 'application/gzip',
        ContentLength: fileStats.size,
    });
    await client.send(command);
    console.log(`[S3] Uploaded backup to s3://${bucket}/${s3Key} (${fileStats.size} bytes)`);
    return {
        bucket,
        key: s3Key,
        size: fileStats.size,
    };
}
export async function downloadBackupFromS3(s3Key, localPath) {
    const { client, bucket } = await getS3Client();
    const command = new GetObjectCommand({
        Bucket: bucket,
        Key: s3Key,
    });
    const response = await client.send(command);
    if (!response.Body) {
        throw new Error(`No body returned for S3 object: ${s3Key}`);
    }
    const writeStream = createWriteStream(localPath);
    await pipeline(response.Body, writeStream);
    console.log(`[S3] Downloaded s3://${bucket}/${s3Key} to ${localPath}`);
}
export async function listBackupsFromS3() {
    const { client, bucket } = await getS3Client();
    const command = new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: 'backup-',
    });
    const response = await client.send(command);
    if (!response.Contents) {
        return [];
    }
    const backups = response.Contents.filter((obj) => obj.Key && obj.Size).map((obj) => ({
        key: obj.Key,
        filename: obj.Key.split('/').pop() || obj.Key,
        size: obj.Size,
        lastModified: obj.LastModified || new Date(),
    }));
    backups.sort((a, b) => b.lastModified.getTime() - a.lastModified.getTime());
    return backups;
}
export async function deleteBackupFromS3(s3Key) {
    const { client, bucket } = await getS3Client();
    const command = new DeleteObjectCommand({
        Bucket: bucket,
        Key: s3Key,
    });
    await client.send(command);
    console.log(`[S3] Deleted s3://${bucket}/${s3Key}`);
}
export async function testS3Connection() {
    try {
        const { client, bucket } = await getS3Client();
        const command = new HeadBucketCommand({
            Bucket: bucket,
        });
        await client.send(command);
        return { success: true };
    }
    catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        console.error('[S3] Connection test failed:', message);
        return { success: false, error: message };
    }
}
export async function getBackupDownloadUrl(s3Key, expiresIn = 3600) {
    const { client, bucket } = await getS3Client();
    const command = new GetObjectCommand({
        Bucket: bucket,
        Key: s3Key,
    });
    const url = await getSignedUrl(client, command, { expiresIn });
    return url;
}
export async function isS3Configured() {
    const settings = await prisma.settings.findFirst();
    return !!(settings?.backupS3Bucket &&
        settings?.backupS3AccessKeyId &&
        settings?.backupS3SecretAccessKey);
}
export async function deleteOldBackupsFromS3(retentionDays) {
    const backups = await listBackupsFromS3();
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - retentionDays);
    let deletedCount = 0;
    for (const backup of backups) {
        if (backup.lastModified < cutoffDate) {
            await deleteBackupFromS3(backup.key);
            deletedCount++;
        }
    }
    if (deletedCount > 0) {
        console.log(`[S3] Deleted ${deletedCount} old backups (older than ${retentionDays} days)`);
    }
    return deletedCount;
}
