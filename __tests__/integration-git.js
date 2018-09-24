/* @flow */

import path from 'path';

import GitServer from 'node-git-server';
import getPort from 'get-port';
import rimraf from 'rimraf';
import execa from 'execa';
import mkdirp from 'mkdirp';
import makeTemp from './_temp.js';
import * as fs from '../src/util/fs.js';
import {promisify} from '../src/util/promise.js';

const createDir = promisify(mkdirp);
const remove = promisify(rimraf);
const gitEnv = {GIT_CONFIG: path.join('doesn', 'exist')};

describe('while adding git packages', () => {
  const gitServerDirName = 'server';
  const gitClientDirName = 'client';
  const gitRepoOwner = 'john-doe';
  const gitRepoName = 'foo';
  let tempDir;
  let gitServer;
  let gitServerUrl;
  let gitClientDir;

  beforeAll(async () => {
    tempDir = await makeTemp();
    const gitServerDir = path.join(tempDir, gitServerDirName);
    gitClientDir = path.join(tempDir, gitClientDirName);
    await createDir(gitClientDir);
    await createDir(gitServerDir);
    const port = await getPort();
    const gitServerResult = createGitServer(gitServerDir);
    await gitServerResult.listen(port);
    gitServer = gitServerResult.gitServer;
    gitServerUrl = `http://localhost:${port}`;
    await prepareRepo(gitServerUrl, gitRepoOwner, gitRepoName, gitClientDir);
  });

  afterAll(async () => {
    if (gitServer) {
      gitServer.close();
    }
    if (tempDir) {
      await remove(tempDir);
    }
  });

  test('yarn add should fetch tags for cached git repo', async () => {
    const consumer = await createConsumer();
    const firstVersion = '1.0.0';
    const secondVersion = '2.0.0';

    await createRepoFiles(gitRepoName, firstVersion, gitClientDir);
    await consumer.add(`${gitServerUrl}/${gitRepoOwner}/${gitRepoName}.git#v${firstVersion}`);

    await createRepoFiles(gitRepoName, secondVersion, gitClientDir);
    await consumer.add(`${gitServerUrl}/${gitRepoOwner}/${gitRepoName}.git#v${secondVersion}`);

    await consumer.clean();
  });
});

function createGitServer(dir: string): {gitServer: GitServer, listen: Function} {
  const gitServer = new GitServer(dir);
  const eventNames = ['push', 'tag', 'fetch', 'info', 'head'];

  eventNames.forEach(eventName => {
    gitServer.on(eventName, event => {
      event.accept();
    });
  });

  const listen = (port: number) =>
    new Promise((resolve, reject) => {
      gitServer.listen(port, err => {
        if (err) {
          return reject(err);
        }
        return resolve();
      });
    });

  return {gitServer, listen};
}

async function prepareRepo(
  gitRemote: string,
  gitRepoOwner: string,
  gitRepoName: string,
  gitClientDir: string,
): Promise<void> {
  await execa('git', ['clone', `${gitRemote}/${gitRepoOwner}/${gitRepoName}`], {
    cwd: gitClientDir,
    env: gitEnv,
  });
}

async function createRepoFiles(name: string, version: string, gitClientDir: string): Promise<void> {
  const repoDir = path.join(gitClientDir, name);

  const indexJSContent = `module.exports = '${version}';\n`;
  const indexJSPath = path.join(repoDir, 'index.js');
  await fs.writeFile(indexJSPath, indexJSContent);

  const pkgContent = JSON.stringify({name, version, license: 'MIT'});
  const pkgPath = path.join(repoDir, 'package.json');
  await fs.writeFile(pkgPath, pkgContent);
  await execa('git', ['add', '.'], {
    cwd: repoDir,
    env: gitEnv,
  });
  await execa('git', ['commit', '-m', '"Init"'], {
    cwd: repoDir,
    env: gitEnv,
  });
  const tagName = `v${version}`;
  await execa('git', ['tag', tagName], {
    cwd: repoDir,
    env: gitEnv,
  });
  await execa('git', ['push', 'origin', 'master'], {
    cwd: repoDir,
    env: gitEnv,
  });
  await execa('git', ['push', 'origin', tagName], {
    cwd: repoDir,
    env: gitEnv,
  });
}

async function createConsumer(): Promise<{add: Function, clean: Function}> {
  const cwd = await makeTemp();
  const cacheFolder = path.join(cwd, 'cache');
  const command = path.resolve(__dirname, '../bin/yarn');
  const options = {cwd, env: gitEnv};

  await fs.writeFile(
    path.join(cwd, 'package.json'),
    JSON.stringify({
      name: 'test',
      license: 'MIT',
    }),
  );

  return {
    add: async (pattern, yarnArgs: Array<string> = []) => {
      const args = ['--cache-folder', cacheFolder, ...yarnArgs];
      await execa(command, ['add', pattern].concat(args), options);
    },
    clean: async () => {
      await remove(cwd);
    },
  };
}
