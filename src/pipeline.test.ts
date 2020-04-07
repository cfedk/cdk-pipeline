import { SynthUtils } from '@aws-cdk/assert';
import { Stack } from '@aws-cdk/core';

import { DeploymentPipelineConstruct as DeploymentPipeline } from './pipeline';

const SOURCE_CONFIGURATION = {
    owner: 'test-owner',
    repository: 'test-repo',
    oauthTokenName: 'super-secret',
};

describe('pipeline definition with no service stacks', () => {

    describe('without manual approval', () => {
        const stack = new Stack(undefined, 'MyPipeline');

        const pipeline = new DeploymentPipeline(stack, {
            sourceConfiguration: SOURCE_CONFIGURATION,
            manualApproval: false,
            deploymentStages: [],
        });

        it('creates no more stages than required', () => {
            expect(pipeline.pipeline.stages).toHaveLength(3);
            expect(pipeline.pipeline.stages[2].actions).toHaveLength(1);
        });

        it('matches the snapshot', () => {
            expect(SynthUtils.toCloudFormation(stack)).toMatchSnapshot();
        });
    });

    describe('with a manual approval step', () => {
        const stack = new Stack(undefined, 'MyPipeline');
        const pipeline = new DeploymentPipeline(stack, {
            sourceConfiguration: SOURCE_CONFIGURATION,
            manualApproval: {
                approvalNotificationEmail:  'me@test.com',
            },
            deploymentStages: []
        });

        it('adds an action to the last stage', () => {
            expect(pipeline.pipeline.stages).toHaveLength(3);
            expect(pipeline.pipeline.stages[2].actions).toHaveLength(2);
        });

        it('matchest the snapshot', () => {
            expect(SynthUtils.toCloudFormation(stack)).toMatchSnapshot();
        });
    });
});

describe('pipeline definition with a single service stack', () => {

    describe('without manual verification', () => {

        const pipelineStack = new Stack(undefined, 'MyPipeline');
        const serviceStack = new Stack(undefined, 'MyService');

        const pipeline = new DeploymentPipeline(pipelineStack, {
            sourceConfiguration: SOURCE_CONFIGURATION,
            manualApproval: false,
            deploymentStages: [{
                stack: serviceStack,
                stageName: 'Beta',
                manualApproval: false,
            }]
        });

        test('pipeline deploys deploys additional stage', () => {
            expect(pipeline.pipeline.stageCount).toBe(4);
        });

        test('does not add verification action to final stage', () => {
            expect(pipeline.pipeline.stages[3].actions).toHaveLength(1);
        });

        test('matchest snapshot', () => {
            expect(SynthUtils.toCloudFormation(pipelineStack)).toMatchSnapshot();
        });
    });

    describe('with manual verification on service deployment stage', () => {

        const pipelineStack = new Stack(undefined, 'MyPipeline');
        const serviceStack = new Stack(undefined, 'MyService');

        const pipeline = new DeploymentPipeline(pipelineStack, {
            sourceConfiguration: SOURCE_CONFIGURATION,
            manualApproval: false,
            deploymentStages: [{
                stack: serviceStack,
                stageName: 'Beta',
                manualApproval: {
                    approvalNotificationEmail: 'me@test.com',
                },
            }]
        });

        test('adds additional action to service deployment stage', () => {
            expect(pipeline.pipeline.stageCount).toBe(4);
            expect(pipeline.pipeline.stages[3].actions).toHaveLength(2);
        });

        test('matches snapshot', () => {
            expect(SynthUtils.toCloudFormation(pipelineStack)).toMatchSnapshot();
        });
    });
});
