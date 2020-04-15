# What is this thing?

A self-mutating pipeline definition for cdk apps sourced from GitHub repos.
On push to master, CodePipelines will build and deploy your cdk application to whatever stages you have defined.

# Installation

```
npm install --save @cfedk/cdk-pipeline
```

# Usage

* Create Github access token `<github-secret>`. It should have permissions to read your repo and create/delete hooks.
* Add access token to SecretsManager `aws secretsmanager create-secret --name <github-token-name> --secret-string <github-secret> --region <pipeline-region>`
* Include a pipeline spec from your cdk entry point:

```
import * as cdk from '@aws-cdk/core';
import { DeploymentPipeline, makeStack } from '@cfedk/cdk-pipeline';

// Make a cdk construct for a particular stage (allows stage-specific naming of domains, etc).
// Note that return type of `makeStage`: `(scope: cdk.Construct) => cdk.Construct`.
import { makeStage } from './my-app-root';

const app = new cdk.App();

// Not included in pipeline.
const devStack = makeStack(app, 'dev', {}, stage('dev'));

const betaStack = makeStack(app, 'myapp-beta', { env: { region: '<beta-region>' } }, makeStage('beta'));
const prodStack = makeStack(app, 'myapp-prod', { env: { region: '<prod-region>' } }, makeStage('prod'));

new DeploymentPipeline(
    app,
    'myapp-pipeline',
    { env: { region: '<pipeline-region>' } },
    {
        sourceConfiguration: {
            repository: '<this-respository-name>'
            owner: '<my-github-name>',
            oauthTokenName: '<github-oauth-token-name'>,
        },
        manualApproval: false,
        deploymentStages: [
            {
                stageName: 'Beta',
                stack: betaStack,
            },
            {
                stageName: 'Prod',
                stack: prodStack,
            },
        ],
    },
);
```

* `npm run build`
* `cdk synth`
* `cdk deploy myapp-pipeline`

Once that's done deploying, when you push changes to myapp-github, the pipeline will initiate a deployment of itself, `betaStack`, and `prodStack` in corresponding regions.
Deployment regions can be the same (normal resource naming constraints apply). Cross-account deployment is not explicitly supported.