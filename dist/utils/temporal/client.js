import { Connection, Client } from '@temporalio/client';
let temporalClient = null;
export async function getTemporalClient() {
    if (!temporalClient) {
        const connection = await Connection.connect();
        temporalClient = new Client({ connection });
    }
    return temporalClient;
}
// Backwards compatibility export
export { temporalClient };
