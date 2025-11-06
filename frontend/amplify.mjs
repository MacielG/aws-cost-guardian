import { cpSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';

const amplifyDirectories = [
  '.amplify-hosting',
  '.amplify-hosting/static',
  '.amplify-hosting/compute',
  '.amplify-hosting/compute/default',
  '.amplify-hosting/compute/default',
];

// Create the directories
amplifyDirectories.forEach((dir) => {
  // Esta parte está correta
  mkdirSync(join(process.cwd(), dir), { recursive: true });
});

// Deploy manifest config
const deployManifestConfig = {
  version: 1,
  routes: [
    {
      path: '/_next/static/*',
      target: {
        kind: 'Static',
      },
    },
    {
      path: '/api/*',
      target: {
        kind: 'Compute',
        src: 'default',
      },
    },
    {
      path: '/_next/image*',
      target: {
        kind: 'Compute',
        src: 'default',
      },
    },
    {
      path: '/*.*',
      target: {
        kind: 'Static',
      },
      fallback: {
        kind: 'Compute',
        src: 'default',
      },
    },
    {
      path: '/*',
      target: {
        kind: 'Compute',
        src: 'default',
      },
    },
  ],
  computeResources: [
    {
      name: 'default',
      entrypoint: './server.js',
      runtime: 'nodejs20.x',
    },
  ],
  framework: {
    name: 'next',
    version: '14.2.33',
  },
};

// Write the config to .amplify-hosting/deploy-manifest.json
// Esta parte está correta
writeFileSync(
  join(process.cwd(), '.amplify-hosting', 'deploy-manifest.json'),
  JSON.stringify(deployManifestConfig)
);

// --- INÍCIO DA CORREÇÃO ---
// Precisamos de construir os caminhos de destino absolutos
const staticDir = join(process.cwd(), amplifyDirectories[1]); // .amplify-hosting/static
const computeDir = join(process.cwd(), amplifyDirectories[4]); // .amplify-hosting/compute/default

// Copy the static assets generated in .next/static and public to .amplify-hosting/static directory
cpSync(join(process.cwd(), 'public'), staticDir, { recursive: true });
cpSync(join(process.cwd(), '.next', 'static'), join(staticDir, '_next', 'static'), { recursive: true });

// Copy the standalone build to .amplify-hosting/compute/default
cpSync(join(process.cwd(), '.next', 'standalone'), computeDir, { recursive: true });

// Remove .next/static and public from .amplify-hosting/compute/default
// (Usamos os caminhos absolutos para garantir que apagamos os ficheiros certos)
rmSync(join(computeDir, '.next', 'static'), { force: true, recursive: true });
rmSync(join(computeDir, 'public'), { force: true, recursive: true });
// --- FIM DA CORREÇÃO ---