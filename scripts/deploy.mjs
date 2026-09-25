// Copies the built plugin into an Obsidian vault's plugin folder.
//
// The target folder comes from LOREBASE_DEPLOY_DIR or, failing that, the first line of
// `.deploy-target` in the repo root (git-ignored, so a personal vault path stays out of
// the repo). As a guard, it only deploys into a folder whose manifest.json has id
// "lorebase". Run through `npm run deploy`, which builds first.
import { copyFileSync, existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const FILES = ['main.js', 'styles.css', 'manifest.json'];
const root = resolve(import.meta.dirname, '..');
const targetFile = join(root, '.deploy-target');

const target = process.env.LOREBASE_DEPLOY_DIR
    || (existsSync(targetFile) ? readFileSync(targetFile, 'utf8').split('\n')[0].trim() : '');

if (!target) {
    console.error('No deploy target. Put the vault plugin folder path in .deploy-target, e.g.');
    console.error('  /path/to/Vault/.obsidian/plugins/lorebase');
    process.exit(1);
}

const manifestPath = join(target, 'manifest.json');
if (!existsSync(manifestPath)) {
    console.error(`Not a plugin folder (no manifest.json): ${target}`);
    process.exit(1);
}
const installedId = JSON.parse(readFileSync(manifestPath, 'utf8')).id;
if (installedId !== 'lorebase') {
    console.error(`Refusing to deploy: ${target} holds plugin "${installedId}", not "lorebase".`);
    process.exit(1);
}

for (const file of FILES) {
    copyFileSync(join(root, file), join(target, file));
}
console.log(`Deployed ${FILES.join(', ')} to ${target}`);
console.log('Reload the plugin in Obsidian (toggle it off and on) to pick it up.');
