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
      entrypoint: 'server.js',
      runtime: 'nodejs18.x',
    },
  ],
  framework: {
    name: 'next',
    version: '14.2.33',
  },
};

// Write the config to .amplify-hosting/deploy-manifest.json
writeFileSync(
  join(process.cwd(), '.amplify-hosting', 'deploy-manifest.json'),
  JSON.stringify(deployManifestConfig)
);

// Copy the static assets generated in .next/static and public to .amplify-hosting/static directory
cpSync(join(process.cwd(), 'public'), amplifyDirectories[1], { recursive: true });
cpSync(join(process.cwd(), '.next', 'static'), join(amplifyDirectories[1], '_next', 'static'), { recursive: true });

// Copy the standalone build to .amplify-hosting/compute/default
cpSync(join(process.cwd(), '.next', 'standalone'), amplifyDirectories[4], { recursive: true });

// Remove .next/static and public from .amplify-hosting/compute/default
rmSync(join(amplifyDirectories[4], '.next', 'static'), { force: true, recursive: true });
rmSync(join(amplifyDirectories[4], 'public'), { force: true, recursive: true });
