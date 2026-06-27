'use strict';
// Launch electron with ELECTRON_RUN_AS_NODE unset.
// pnpm (and other tools that use the electron binary as a Node.js runtime) can
// leave ELECTRON_RUN_AS_NODE=1 in the environment, which silently disables all
// Electron APIs and GUI initialization. Deleting it here before spawn ensures
// the electron process always starts in full app mode.
const { spawn } = require('child_process');
const path = require('path');
const electron = require('electron'); // path string from npm package (expected)

const env = { ...process.env, NODE_ENV: process.env.NODE_ENV || 'development' };
delete env.ELECTRON_RUN_AS_NODE;

const child = spawn(electron, [path.resolve(__dirname)], { stdio: 'inherit', env });
child.on('close', (code) => process.exit(code ?? 0));
