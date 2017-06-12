#!/usr/bin/env node

const console = require('console');
const yaml = require('js-yaml');
const fs = require('fs');
const path = require('path');
const github = require('github');
const exec = require('child_process').execSync;
const findup = require('findup-sync');
const packagejson = require(findup('package.json'));
const semver = require('semver');
const clc = require('cli-color');
const error = (message) => {
    console.error(clc.red.bold(message));
};
const info = (message) => {
    console.log(clc.green(message));
};

// const argv = require('minimist')(process.argv.slice(2));
const g = new github({
    timeout: 5000
});

const configFile = process.env.HUB_CONFIG ? process.env.HUB_CONFIG : process.env.HOME + '/.config/hub';
const config = yaml.safeLoad(fs.readFileSync(path.resolve(configFile), 'utf8'));

if (!config['github.com'] || !config['github.com'][0] || !config['github.com'][0]['oauth_token']) {
    error(`Invalid ${configFile}`);
    process.exit(1);
}

g.authenticate({
    type: 'oauth',
    token: config['github.com'][0]['oauth_token']
});

const currentVersion = packagejson.version;
const currentVersionTag = `v${currentVersion}`;

exec(`git tag ${currentVersionTag}`);
info(`Tagged ${currentVersionTag}.`);
exec(`git push origin ${currentVersionTag}`);
info('Pushed commits and tags.');

let previousVersion = '0.0.0';
let v0_tag_exist = false;
exec('git tag').toString().split('\n').forEach((t) => {
    if (semver.clean(t) === '0.0.0') {
        v0_tag_exist = true;
    }
    if (semver.valid(t)
        && semver.gt(semver.clean(t), previousVersion)
        && semver.gt(currentVersion, semver.clean(t))) {
        previousVersion = semver.clean(t);
    }
});

let previousVersionTag = '';
if (previousVersion !== '0.0.0' || v0_tag_exist) {
    previousVersionTag = `v${previousVersion}`;
}

let log = exec(`git log ${previousVersionTag}..${currentVersionTag} --grep=Merge`).toString();
const ownerRepo = exec('git remote -v | grep origin').toString().match(/([\w-]+\/[\w-]+)\.git/)[1];
const owner = ownerRepo.split('/')[0];
const repo = ownerRepo.split('/')[1];

let promises = [];
let description = [];
log.split(/commit/).forEach((lines) => {
    let matches = lines.match(/Merge pull request \#(\d+)/);
    if (!matches) {
        return;
    }
    let pull_id = matches[1];
    let url = `https://github.com/${owner}/${repo}/pull/${pull_id}`;
    promises.push(g.pullRequests.get({
        owner: owner,
        repo: repo,
        number: pull_id
    }).then((pr) => {
        let title = pr.data.title;
        description.push(`* [${title}](${url})`);
        return g.issues.createComment({
            owner: owner,
            repo: repo,
            number: pull_id,
            body: `Released as ${currentVersionTag}.`,
        });
    }));
    info(`Added a release comment to the pull request #${pull_id}`);
});

Promise.all(promises)
    .then(() => {
        return g.repos.createRelease({
            owner: owner,
            repo: repo,
            tag_name: currentVersionTag,
            body: description.join('\n')
        });
    })
    .then(() => {
        info(`Create a release ${currentVersionTag}`);
        info(`https://github.com/${owner}/${repo}/releases/tag/${currentVersionTag}`);
    })
    .catch((err) => {
        console.error(err);
    });
