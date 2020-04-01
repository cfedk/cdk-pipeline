import * as cdk from '@aws-cdk/core';
import * as codebuild from '@aws-cdk/aws-codebuild';
import * as codepipeline from '@aws-cdk/aws-codepipeline';
import * as actions from '@aws-cdk/aws-codepipeline-actions';

import * as iam from '@aws-cdk/aws-iam';

import * as path from 'path';
import * as fs from 'fs';
import * as yaml from 'js-yaml';

export interface StageDefinition {
    stageName: string; // Beta, Prod, etc.
    stack: cdk.Stack; // CDK stack to deploy in this region
}

export interface SourceConfiguration {
    repository: string;
    owner: string;
    oauthTokenName: string;
}

export interface DeploymentPipelineProps {
    sourceConfiguration: SourceConfiguration,
}

export class DeploymentPipeline extends cdk.Stack {

    pipeline: codepipeline.Pipeline;

    constructor(
            scope: cdk.Construct,
            id: string,
            stackProps: cdk.StackProps,
            sourceConfiguration: SourceConfiguration,
            deploymentStages: StageDefinition[],
        ) {

        super(scope, id, stackProps);

        const sourceActionOutput = new codepipeline.Artifact('Source');
        const buildActionOutput = new codepipeline.Artifact('Builds');

        const pipeline = new codepipeline.Pipeline(this, 'DP', { pipelineName: 'DeploymentPipeline' });

        const source = pipeline.addStage({ stageName: 'SourceStage' });

        source.addAction(new actions.GitHubSourceAction({
            actionName: 'SourceAction',
            repo: sourceConfiguration.repository,
            owner: sourceConfiguration.owner,
            oauthToken: cdk.SecretValue.secretsManager(sourceConfiguration.oauthTokenName),
            output: sourceActionOutput,
        }));

        const buildStage = pipeline.addStage({ stageName: 'BuildStage' });

        buildStage.addAction(new actions.CodeBuildAction({
            actionName: 'BuildAction',
            project: this.buildCodeBuildProject(),
            input: sourceActionOutput,
            outputs: [ buildActionOutput ],
        }));

        const piplineStage = pipeline.addStage({
            stageName: 'DeployPipelineStage',
        });

        piplineStage.addAction(new actions.CodeBuildAction({
            actionName: 'DeployPipelineAction',
            project: this.deployCodeBuildProject(cdk.Stack.of(this)),
            input: buildActionOutput,
        }));

        deploymentStages.forEach((stageDefinition) => {
            const stage = pipeline.addStage({
                stageName: `Deploy${stageDefinition.stageName}Stage`,
            });
            stage.addAction(new actions.CodeBuildAction({
                actionName: `Deploy${stageDefinition.stageName}Action`,
                project: this.deployCodeBuildProject(stageDefinition.stack),
                input: buildActionOutput,
            }));
        });
    }

    private buildCodeBuildProject(): codebuild.PipelineProject {
        return new codebuild.PipelineProject(this, 'Build', {
            projectName: 'Build',
            buildSpec: this.buildSpec('build.yaml'),
        });
    }

    private deployCodeBuildProject(stack: cdk.Stack): codebuild.PipelineProject {
        const stackName = stack.stackName;
        const project = new codebuild.PipelineProject(this, `Deploy${stackName}`, {
            projectName: `Deploy${stackName}`,
            buildSpec: this.buildSpec('deploy.yaml'),
            environmentVariables: {
                STACK_NAME: { value: stackName },
            },
        });

        project.role?.addManagedPolicy(iam.ManagedPolicy.fromAwsManagedPolicyName('AdministratorAccess'));

        return project;
    }

    private buildSpec(name: string): codebuild.BuildSpec {
        // Need to inline the buildspec or codebuild will assume it's relative to the input artifact.
        const buildSpecSource = path.join(__dirname, '..', 'buildspec', name);
        const fileContents = fs.readFileSync(buildSpecSource, 'utf8');
        const buildSpecDefinition = yaml.safeLoad(fileContents);
        return codebuild.BuildSpec.fromObject(buildSpecDefinition);
    }
}

export function makeStack(
    app: cdk.App,
    stackName: string,
    stackProps: cdk.StackProps,
    stackPopulator: (scope: cdk.Construct) => cdk.Construct,
): cdk.Stack {
    const stack = new cdk.Stack(app, stackName, stackProps);
    stackPopulator(stack);
    return stack;
}

