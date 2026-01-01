import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import yaml from 'js-yaml';
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
// Load OpenAPI spec from YAML file
const openApiPath = join(__dirname, '../../openapi.yaml');
const openApiContent = readFileSync(openApiPath, 'utf8');
const openApiSpec = yaml.load(openApiContent);
export const apiSpec = openApiSpec;
