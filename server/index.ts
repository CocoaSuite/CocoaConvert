import { buildApp } from './app';
import { loadConfig } from './config';
import { detectTools } from './process';

const config = loadConfig();
const tools = await detectTools();
const app = await buildApp(config, tools);

const found = Object.entries(tools)
  .filter(([k, v]) => k !== 'isolate' && v)
  .map(([k]) => k);
app.log.info(
  { tools: found, networkIsolation: tools.isolate.length > 0 },
  'conversion tools detected',
);

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    void app.close().then(() => process.exit(0));
  });
}

await app.listen({ host: config.host, port: config.port });
