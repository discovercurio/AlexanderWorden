// Generate the browser map configuration during a Vercel build.
const fs = require('node:fs');
const path = require('node:path');

const key = String(process.env.CARTO_API_KEY || '').trim();
if (!key) {
  console.error('CARTO_API_KEY is missing. Add it to the Vercel project environment variables and redeploy.');
  process.exit(1);
}

const configPath = path.join(__dirname, '..', 'demos', 'dispatch-tool', 'config.js');
fs.writeFileSync(configPath, `window.CARTO_API_KEY = ${JSON.stringify(key)};\n`, 'utf8');
console.log('Dispatch map configuration generated.');
